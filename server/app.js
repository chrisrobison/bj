/* eslint-disable no-restricted-syntax */
/* eslint-disable no-param-reassign */
// server/app.js
require('dotenv').config();
const express = require('express');
const https = require('https');
const fs = require('fs');
const WebSocket = require('ws');
const cors = require('cors');
const multer = require('multer');
const Auth = require('./auth');
const { TableManager } = require('./tableManager');
const { TransactionManager } = require('./transactions');
const { GameStateManager } = require('./gameStateManager');
const ProfileHandler = require('./profile');
const AdminHandler = require('./adminHandler');
const { adminAuthMiddleware } = require('./middleware/adminAuth');

// Initialize managers
const tableManager = new TableManager();
const transactionManager = new TransactionManager();
const gameStateManager = new GameStateManager();

// Make gameStateManager available globally for TableManager
global.gameStateManager = gameStateManager;
global.clients = new Map();

// SSL configuration
const sslConfig = {
  cert: fs.readFileSync(
    '/etc/letsencrypt/live/11oclocktoast.com/fullchain.pem',
  ),
  key: fs.readFileSync('/etc/letsencrypt/live/11oclocktoast.com/privkey.pem'),
  ca: fs.readFileSync('/etc/letsencrypt/live/11oclocktoast.com/chain.pem'),
};

// CORS configuration
const corsOptions = {
  origin: true, // Reflects the request origin. In production, you'd want to list specific origins
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400, // How long the results of a preflight request can be cached
};

// Configure multer for file uploads
const upload = multer({
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    return cb(null, true);
  },
});

// Express app setup
const app = express();
app.use(cors(corsOptions));
app.use(express.static('public'));
app.use(express.json());

const PORT = process.env.PORT || 4444;
const server = https.createServer(sslConfig, app);

// Create WebSocket server
const wss = new WebSocket.Server({
  server,
  clientTracking: true,
  perMessageDeflate: true,
});

// Track client connections
const clients = new Map();

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  console.log('Auth header:', authHeader); // Debug log

  const mytoken = authHeader && authHeader.split(' ')[1];
  if (!mytoken) {
    return res.status(401).json({
      error: 'No token provided',
    });
  }

  const myuser = Auth.verifyToken(mytoken);
  console.log('Verified user:', myuser); // Debug log

  if (!myuser) {
    return res.status(403).json({
      error: 'Invalid token',
    });
  }

  req.user = myuser;
  return next();
}

// WebSocket connection handling
wss.on('connection', async (ws, req) => {
  console.log('New WebSocket connection attempt');

  const url = new URL(req.url, 'ws://localhost');
  const token = url.searchParams.get('token');

  if (!token) {
    console.error('No token provided in connection');
    ws.close(4001, 'No token provided');
    return;
  }

  console.log('Verifying token...');
  const user = Auth.verifyToken(token);
  if (!user) {
    console.error('Invalid token');
    ws.close(4001, 'Unauthorized');
    return;
  }

  console.log('User authenticated:', user.username);
  ws.user = user;
  
  // Set admin flag if applicable
  ws.isAdmin = user.isAdmin || false;

  global.clients.set(ws, {
    id: user.id,
    username: user.username,
    tableId: null,
  });

  console.log('Client added to active connections');
  console.log('Current clients:', Array.from(global.clients.keys()).length);

  // Send initial state to admins
  if (ws.isAdmin) {
    try {
      const games = await AdminHandler.getActiveGames();
      ws.send(JSON.stringify({
        type: 'game_state',
        games,
      }));
    } catch (error) {
      console.error('Error sending initial state to admin:', error);
    }
  }

  // Broadcast current game state to all clients
  function sendError(conn, message) {
    conn.send(
      JSON.stringify({
        type: 'error',
        message,
      }),
    );
  }

  async function broadcastTableState(tableId) {
    try {
      const state = await gameStateManager.getTableState(tableId);
      const connectedClients = Array.from(clients.entries())
        .filter(([, client]) => client.tableId === tableId);

      // Create an array of promises for all player views
      const playerViewPromises = connectedClients.map(async ([conn, client]) => {
        try {
          const playerView = await gameStateManager.getPlayerView(
            tableId,
            client.id,
            state,
          );

          // Return connection and view together
          return { conn, playerView };
        } catch (error) {
          console.error(`Error getting player view for client ${client.id}:`, error);
          return { conn, error };
        }
      });

      // Wait for all player views to be generated in parallel
      const results = await Promise.all(playerViewPromises);

      // Send the results to each client
      for (const result of results) {
        try {
          if (result.error) {
            sendError(result.conn, 'Error updating game state');
          }

          result.conn.send(JSON.stringify({
            type: 'state_update',
            data: result.playerView,
          }));
        } catch (error) {
          console.error('Error sending state to client:', error);
          sendError(result.conn, 'Error updating game state');
        }
      }
    } catch (error) {
      console.error('Error in broadcastTableState:', error);
      // Handle the error appropriately
    }
  }

  async function broadcastToAdmins(data) {
    const adminSockets = Array.from(wss.clients).filter(
      (client) => client.isAdmin && client.readyState === WebSocket.OPEN,
    );

    for (const adminWs of adminSockets) {
      try {
        adminWs.send(JSON.stringify(data));
      } catch (error) {
        console.error('Error broadcasting to admin:', error);
      }
    }
  }

  // Add this call wherever game state changes
  // Example: after a bet is placed, player action, etc.
  //
  // await broadcastToAdmins({
  //    type: 'game_state',
  //    games: await AdminHandler.getActiveGames()
  // });

  // Table operations
  async function handleJoinTable(conn, client, message) {
    const { tableId } = message;
    try {
    // Find or create a table using tableManager
      const targetTableId = tableId || (await tableManager.findOrCreateTable());

      // Get the table instance from tableManager
      const table = tableManager.getTable(targetTableId);
      if (!table) {
        throw new Error('Table not found after creation');
      }

      // Add player to the table
      const positionId = await tableManager.addPlayerToTable(
        targetTableId,
        client.id,
      );

      const clientInfo = global.clients.get(conn);
      if (clientInfo) {
        clientInfo.tableId = targetTableId;
        clientInfo.positionId = positionId;
        global.clients.set(conn, clientInfo);
      }

      // Make sure GameStateManager knoconn about this table
      gameStateManager.trackTable(targetTableId, table);

      // Initialize game state for the table if needed
      const activeGameId = await gameStateManager.getActiveGameId(targetTableId);
      if (!activeGameId) {
        await gameStateManager.startNewGame(targetTableId);
      }

      // Broadcast updated state to all players at the table
      await broadcastTableState(targetTableId);
    } catch (error) {
      console.error('Error joining table:', error);
      sendError(conn, error.message);
    }
  }

  async function handlePlaceBet(conn, client, message) {
    const { amount } = message;
    console.log('Handling bet:', {
      amount,
      clientId: client.id,
      tableId: client.tableId,
    });

    try {
    // Process the bet through transaction manager
      await transactionManager.processBet(client.id, amount);

      // Get current game ID
      const gameId = await gameStateManager.getActiveGameId(client.tableId);

      if (!gameId) {
        await gameStateManager.startNewGame(client.tableId);
      }

      // Place bet in table
      await tableManager.placeBet(client.tableId, client.id, amount);

      // Send bet to admins
      await broadcastToAdmins({
        type: 'game_state',
        games: await AdminHandler.getActiveGames(),
      });

      // Broadcast updated state
      await broadcastTableState(client.tableId);
    } catch (error) {
      console.error('Error handling bet:', error);
      sendError(conn, error.message);
    }
  }

  async function handlePlayerAction(conn, client, message) {
    const { action } = message;

    try {
      const gameId = await gameStateManager.getActiveGameId(client.tableId);
      await tableManager.handlePlayerAction(
        client.tableId,
        gameId,
        client.id,
        action,
        message.actionData,
      );

      // Broadcast updated state
      await broadcastTableState(client.tableId);
    } catch (error) {
      sendError(conn, error.message);
    }
  }

  // Utility functions
  // Message handling
  async function handleMessage(conn, message) {
    const client = global.clients.get(conn);

    try {
      switch (message.type) {
        case 'join_table':
          await handleJoinTable(ws, client, message);
          break;
        case 'place_bet':
          await handlePlaceBet(ws, client, message);
          break;
        case 'action':
          await handlePlayerAction(ws, client, message);
          break;
        default:
          sendError(ws, 'Unknown message type');
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendError(ws, error.message);
    }
  }

  ws.on('message', async (message) => {
    console.log('Received message from client:', message.toString());
    try {
      const data = JSON.parse(message);
      await handleMessage(ws, data);
    } catch (error) {
      console.error('Message handling error:', error);
      sendError(ws, 'Invalid message format');
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected:', ws.user.username);
    const client = global.clients.get(ws);
    if (client.tableId) {
      tableManager.removePlayerFromTable(client.id, client.tableId);
    }
    global.clients.delete(ws);

    console.log('Client removed from active connections');
    console.log('Remaining clients:', Array.from(global.clients.keys()).length);
  });
});

// REST endpoints
app.get('/api/tables', (req, res) => {
  const tables = Array.from(tableManager.tables.values()).map((table) => ({
    id: table.id,
    players: table.players.size,
    config: table.config,
    gamePhase: table.gamePhase,
  }));
  return res.json(tables);
});

app.post('/auth/signup', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    // Basic validation
    if (!username || !email || !password) {
      return res.status(400).json({
        error: 'Missing required fields',
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: 'Password must be at least 8 characters',
      });
    }

    const result = await Auth.createUser(username, email, password);
    return res.json({
      message: 'User created successfully',
      token: result.token,
    });
  } catch (error) {
    res.status(400).json({
      error: error.message,
    });
  }
  return res.status(200).json({ status: 'ok' });
});

app.post('/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const userData = await Auth.authenticateUser(username, password);
    res.json(userData);
  } catch (error) {
    res.status(401).json({
      error: error.message,
    });
  }
});

// Submit profile information
app.post(
  '/api/profile/submit',
  authMiddleware,
  upload.single('idFile'),
  async (req, res) => {
    try {
      // Validate required files
      if (!req.file) {
        return res.status(400).json({
          error: 'ID document is required',
        });
      }

      const profileData = {
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        dob: req.body.dob,
        nationality: req.body.nationality,
        email: req.body.email,
        phone: req.body.phone,
        street: req.body.street,
        street2: req.body.street2,
        city: req.body.city,
        state: req.body.state,
        postal: req.body.postal,
        country: req.body.country,
        idType: req.body.idType,
        idNumber: req.body.idNumber,
        idExpiry: req.body.idExpiry,
      };

      // Basic validation (could be more extensive)
      if (!profileData.firstName || !profileData.lastName || !profileData.dob) {
        return res.status(400).json({
          error: 'Missing required fields',
        });
      }

      const result = await ProfileHandler.submitProfile(
        req.user.id,
        profileData,
        req.file,
      );
      return res.json(result);
    } catch (error) {
      console.error('Profile submission error:', error);
      return res.status(400).json({
        error: error.message,
      });
    }
  },
);

// Get Profile status
app.get('/api/profile/status', authMiddleware, async (req, res) => {
  try {
    const status = await ProfileHandler.getProfileStatus(req.user.id);
    if (!status) {
      return res.status(404).json({
        error: 'No Profile information found',
      });
    }
    return res.json(status);
  } catch (error) {
    console.error('Profile status error:', error);
    return res.status(500).json({
      error: error.message,
    });
  }
});

// Get Profile information
app.get('/api/profile/info', authMiddleware, async (req, res) => {
  try {
    const info = await ProfileHandler.getProfileInfo(req.user.id);
    if (!info) {
      return res.status(404).json({
        error: 'No Profile information found',
      });
    }
    return res.json(info);
  } catch (error) {
    console.error('Profile info error:', error);
    return res.status(500).json({
      error: error.message,
    });
  }
});

// Admin route to update Profile status
app.post('/api/profile/:id/status', authMiddleware, async (req, res) => {
  try {
    // Add admin verification here
    if (!req.user.isAdmin) {
      return res.status(403).json({
        error: 'Unauthorized',
      });
    }

    const { status, rejectionReason } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        error: 'Invalid status',
      });
    }

    await ProfileHandler.updateProfileStatus(
      req.params.id,
      status,
      req.user.id,
      rejectionReason,
    );

    return res.json({
      message: 'Profile status updated successfully',
    });
  } catch (error) {
    console.error('Profile status update error:', error);
    return res.status(500).json({
      error: error.message,
    });
  }
});

// Admin dashboard data
app.get('/api/admin/dashboard', adminAuthMiddleware, async (req, res) => {
  try {
    const stats = await AdminHandler.getDashboardStats();
    const activeGames = await AdminHandler.getActiveGames();

    res.json({
      ...stats,
      activeGames,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({
      error: 'Failed to load dashboard data',
    });
  }
});

// Table management
app.get('/api/admin/tables', adminAuthMiddleware, async (req, res) => {
  try {
    const tables = await AdminHandler.getTables();
    res.json(tables);
  } catch (error) {
    console.error('Tables error:', error);
    res.status(500).json({
      error: 'Failed to load tables',
    });
  }
});

app.post('/api/admin/tables', adminAuthMiddleware, async (req, res) => {
  try {
    const tableId = await AdminHandler.createTable(req.body);
    res.json({
      id: tableId,
    });
  } catch (error) {
    console.error('Table creation error:', error);
    res.status(500).json({
      error: 'Failed to create table',
    });
  }
});

app.post(
  '/api/admin/tables/:id/close',
  adminAuthMiddleware,
  async (req, res) => {
    try {
      await AdminHandler.closeTable(req.params.id);
      res.json({
        message: 'Table closed successfully',
      });
    } catch (error) {
      console.error('Table closure error:', error);
      res.status(500).json({
        error: 'Failed to close table',
      });
    }
  },
);

// Player management
app.get('/api/admin/players', adminAuthMiddleware, async (req, res) => {
  try {
    const searchTerm = req.query.search || '';
    const players = await AdminHandler.getPlayers(searchTerm);
    res.json(players);
  } catch (error) {
    console.error('Players error:', error);
    res.status(500).json({
      error: 'Failed to load players',
    });
  }
});

app.post(
  '/api/admin/players/:id/toggle-status',
  adminAuthMiddleware,
  async (req, res) => {
    try {
      const newStatus = await AdminHandler.togglePlayerStatus(req.params.id);
      res.json({
        status: newStatus,
      });
    } catch (error) {
      console.error('Player status error:', error);
      res.status(500).json({
        error: 'Failed to update player status',
      });
    }
  },
);

// KYC management
app.get('/api/admin/kyc/queue', adminAuthMiddleware, async (req, res) => {
  try {
    const queue = await AdminHandler.getKYCQueue();
    res.json(queue);
  } catch (error) {
    console.error('KYC queue error:', error);
    res.status(500).json({
      error: 'Failed to load KYC queue',
    });
  }
});

app.post('/api/admin/kyc/:id/review', adminAuthMiddleware, async (req, res) => {
  try {
    const { status, rejectionReason } = req.body;
    await AdminHandler.reviewKYC(req.params.id, status, rejectionReason);
    res.json({
      message: 'KYC review completed',
    });
  } catch (error) {
    console.error('KYC review error:', error);
    res.status(500).json({
      error: 'Failed to review KYC submission',
    });
  }
});

// System settings
app.get('/api/admin/settings', adminAuthMiddleware, async (req, res) => {
  try {
    const settings = await AdminHandler.getSystemSettings();
    res.json(settings);
  } catch (error) {
    console.error('Settings error:', error);
    res.status(500).json({
      error: 'Failed to load settings',
    });
  }
});

app.put('/api/admin/settings', adminAuthMiddleware, async (req, res) => {
  try {
    await AdminHandler.updateSystemSettings(req.body);
    res.json({
      message: 'Settings updated successfully',
    });
  } catch (error) {
    console.error('Settings update error:', error);
    res.status(500).json({
      error: 'Failed to update settings',
    });
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`Secure server running on port ${PORT}`);
});

module.exports = {
  app,
  server,
};
