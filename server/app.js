// server/app.js
require('dotenv').config();
const express = require('express');
const https = require('https');
const fs = require('fs');
const WebSocket = require('ws');
const Auth = require('./auth');
const { BlackjackTable, TableManager } = require('./table');
const { TransactionManager } = require('./transactions');
const { GameStateManager } = require('./gameStateManager');
const cors = require('cors');

// Initialize managers
const tableManager = new TableManager();
const transactionManager = new TransactionManager();
const gameStateManager = new GameStateManager();

// Make gameStateManager available globally for TableManager
global.gameStateManager = gameStateManager;

// SSL configuration
const sslConfig = {
    cert: fs.readFileSync('/etc/letsencrypt/live/11oclocktoast.com/fullchain.pem'),
    key: fs.readFileSync('/etc/letsencrypt/live/11oclocktoast.com/privkey.pem'),
    ca: fs.readFileSync('/etc/letsencrypt/live/11oclocktoast.com/chain.pem')
};

// CORS configuration
const corsOptions = {
    origin: true, // Reflects the request origin. In production, you'd want to list specific origins
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
    maxAge: 86400 // How long the results of a preflight request can be cached
};


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
    perMessageDeflate: true
});

// Track client connections
const clients = new Map();

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
    clients.set(ws, { 
        id: user.id,
        username: user.username,
        tableId: null 
    });

    console.log('Client added to active connections');

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
        console.log('Client disconnected:', ws.user?.username);
        const client = clients.get(ws);
        if (client?.tableId) {
            tableManager.removePlayerFromTable(client.id, client.tableId);
        }
        clients.delete(ws);
    });
});

// Message handling
async function handleMessage(ws, message) {
    const client = clients.get(ws);
    
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

// Table operations
async function handleJoinTable(ws, client, message) {
    const { tableId } = message;
    try {
        // Find or create a table using tableManager
        const targetTableId = tableId || await tableManager.findOrCreateTable();
        
        // Get the table instance from tableManager
        const table = tableManager.getTable(targetTableId);
        if (!table) {
            throw new Error('Table not found after creation');
        }

        // Add player to the table
        const positionId = await tableManager.addPlayerToTable(targetTableId, client.id);

        // Make sure GameStateManager knows about this table
        gameStateManager.trackTable(targetTableId, table);

        // Update client info
        clients.get(ws).tableId = targetTableId;
        clients.get(ws).positionId = positionId;

        // Initialize game state for the table if needed
        const activeGameId = await gameStateManager.getActiveGameId(targetTableId);
        if (!activeGameId) {
            await gameStateManager.startNewGame(targetTableId);
        }

        // Broadcast updated state to all players at the table
        await broadcastTableState(targetTableId);
    } catch (error) {
        console.error('Error joining table:', error);
        sendError(ws, error.message);
    }
}

async function handlePlaceBet(ws, client, message) {
    const { amount } = message;
    
    try {
        // Process the bet through transaction manager
        await transactionManager.processBet(client.id, amount);
        
        // Get current game ID
        const gameId = await gameStateManager.getActiveGameId(client.tableId);
        
        // Place bet in game
        await tableManager.placeBet(client.tableId, client.positionId, amount);
        
        // Broadcast updated state
        await broadcastTableState(client.tableId);
    } catch (error) {
        sendError(ws, error.message);
    }
}

async function handlePlayerAction(ws, client, message) {
    const { action } = message;
    
    try {
        const gameId = await gameStateManager.getActiveGameId(client.tableId);
        await tableManager.handlePlayerAction(
            client.tableId,
            gameId,
            client.id,
            action,
            message.actionData
        );
        
        // Broadcast updated state
        await broadcastTableState(client.tableId);
    } catch (error) {
        sendError(ws, error.message);
    }
}

function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];
    console.log('Auth header:', authHeader); // Debug log
    
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) {
        return res.status(401).json({ error: 'No token provided' });
    }

    const user = Auth.verifyToken(token);
    console.log('Verified user:', user); // Debug log
    
    if (!user) {
        return res.status(403).json({ error: 'Invalid token' });
    }

    req.user = user;
    next();
}

// Utility functions
async function broadcastTableState(tableId) {
    try {
        const state = await gameStateManager.getTableState(tableId);
        const connectedClients = Array.from(clients.entries())
            .filter(([_, client]) => client.tableId === tableId);

        for (const [ws, client] of connectedClients) {
            try {
                const playerView = await gameStateManager.getPlayerView(tableId, client.id, state);
                ws.send(JSON.stringify({
                    type: 'state_update',
                    data: playerView
                }));
            } catch (error) {
                console.error('Error sending state to client:', error);
                sendError(ws, 'Error updating game state');
            }
        }
    } catch (error) {
        console.error('Error broadcasting table state:', error);
        // Notify all clients at the table about the error
        const tableClients = Array.from(clients.entries())
            .filter(([_, client]) => client.tableId === tableId);
        for (const [ws, _] of tableClients) {
            sendError(ws, 'Error getting table state');
        }
    }
}

function sendError(ws, message) {
    ws.send(JSON.stringify({
        type: 'error',
        message
    }));
}

function generatePlayerId() {
    return `player_${Math.random().toString(36).substr(2, 9)}`;
}

// REST endpoints
app.get('/api/tables', (req, res) => {
    const tables = Array.from(tableManager.tables.values()).map(table => ({
        id: table.id,
        players: table.players.size,
        config: table.config,
        gamePhase: table.gamePhase
    }));
    res.json(tables);
});

app.post('/auth/signup', async (req, res) => {
    try {
        const { username, email, password } = req.body;

        // Basic validation
        if (!username || !email || !password) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        const result = await Auth.createUser(username, email, password);
        res.json({
            message: 'User created successfully',
            token: result.token
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.post('/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const userData = await Auth.authenticateUser(username, password);
        res.json(userData);
    } catch (error) {
        res.status(401).json({ error: error.message });
    }
});

// Start server
server.listen(PORT, () => {
    console.log(`Secure server running on port ${PORT}`);
});

module.exports = { app, server };
