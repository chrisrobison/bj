/* eslint-disable prefer-destructuring */
/* eslint-disable no-restricted-syntax */
// tableManager.js
const {
  v4: uuidv4
} = require("uuid");
const BlackjackTable = require("./blackjackTable");
const pool = require("./db");

class TableManager {
  constructor() {
    console.log("Initializing TableManager");
    this.tables = new Map(); // Initialize the tables Map
    console.log("TableManager initialized");
  }

  async placeBet(tableId, playerId, amount) {
    console.log("TableManager.placeBet called:", {
      tableId,
      playerId,
      amount,
    });

    const table = this.tables.get(tableId);
    if (!table) {
      throw new Error("Table not found");
    }

    // Validate bet amount against table limits
    if (amount < table.config.minBet || amount > table.config.maxBet) {
      throw new Error(
        `Bet must be between ${table.config.minBet} and ${table.config.maxBet}`
      );
    }

    let positionId;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Get or create player position
      const [positions] = await conn.execute(
        "SELECT id FROM player_positions WHERE table_id = ? AND user_id = ? AND status = ?",
        [tableId, playerId, "active"]
      );

      if (positions.length === 0) {
        const [result] = await conn.execute(
          "INSERT INTO player_positions (table_id, user_id, position, status) VALUES (?, ?, ?, ?)",
          [tableId, playerId, table.players.size, "active"]
        );
        positionId = result.insertId;
      } else {
        positionId = positions[0].id;
      }

      // Get or create active game
      let activeGameId = await global.gameStateManager.getActiveGameId(tableId);
      if (!activeGameId) {
        activeGameId = await global.gameStateManager.startNewGame(tableId);
      }

      // Update player bet in database
      await conn.execute(
        "UPDATE player_hands SET bet_amount = ?, status = ? WHERE game_id = ? AND player_position_id = ?",
        [amount, "ready", activeGameId, positionId]
      );

      // Update in-memory state
      const player = table.players.get(playerId);
      if (player) {
        player.bet = amount;
        player.status = "ready";
      }

      // Check if all players are ready
      const allPlayersReady = Array.from(table.players.values()).every(
        (p) => p.status === "ready"
      );

      await conn.commit();

      if (allPlayersReady) {
        console.log("All players ready, starting new round");
        const newState = await table.startRound();
        console.log("New game state after starting round:", newState);

        // Make sure the state gets broadcast
        if (global.gameStateManager) {
          await global.gameStateManager.broadcastTableState(tableId);
        }

        console.log("New game state after starting round:", newState);
      }

      return true;
    } catch (error) {
      await conn.rollback();
      console.error("Error in placeBet:", error);
      throw error;
    } finally {
      conn.release();
    }
  }

  async createTable(config) {
    console.log("Creating new table with config:", config);
    const table = new BlackjackTable(config);

    // First persist to database
    const conn = await pool.getConnection();
    try {
      console.log("Persisting table to database:", table.id);
      await conn.execute(
        "INSERT INTO tables (id, config, status) VALUES (?, ?, ?)",
        [table.id, JSON.stringify(config), "active"]
      );

      // Store the table in our Map only after successful database insert
      this.tables.set(table.id, table);
      console.log(`Table ${table.id} created and stored in both DB and memory`);

      return table;
    } catch (error) {
      console.error("Error creating table in database:", error);
      throw error;
    } finally {
      conn.release();
    }
  }

  getTable(tableId) {
    console.log("Getting table:", tableId);
    console.log("Available tables:", Array.from(this.tables.keys()));
    return this.tables.get(tableId);
  }

  async findAvailableTable() {
    console.log("Finding available table");
    console.log("Current tables:", Array.from(this.tables.entries()));
    return Array.from(this.tables.values()).find(
      (table) => table.players.size < table.config.maxPlayers
    );
  }

  async checkAndCreateDefaultTable() {
    const conn = await pool.getConnection();
    try {
        // Check if any active tables exist
        const [tables] = await conn.execute(
            'SELECT id FROM tables WHERE status = ?',
            ['active']
        );

        if (tables.length === 0) {
            console.log('No active tables found, creating default table');
            const defaultConfig = {
                decks: 6,
                continuousShuffle: true,
                maxPlayers: 5,
                minBet: 1,
                maxBet: 500,
                doubleDown: 'any',
                doubleAfterSplit: true,
                dealerHitSoft17: true
            };

            const table = await this.createTable(defaultConfig);
            return table.id;
        } else {
            console.log('Active tables found:', tables);
            return tables[0].id;
        }
    } catch (error) {
        console.error('Error checking/creating default table:', error);
        throw error;
    } finally {
        conn.release();
    }
}

// Update findOrCreateTable method to use checkAndCreateDefaultTable
async findOrCreateTable() {
    console.log('Finding or creating table');
    let table = await this.findAvailableTable();

    if (!table) {
        console.log('No available table found, checking for default table');
        const tableId = await this.checkAndCreateDefaultTable();
        table = this.tables.get(tableId);

        if (!table) {
            console.log('Loading table into memory:', tableId);
            const conn = await pool.getConnection();
            try {
                const [tables] = await conn.execute(
                    'SELECT * FROM tables WHERE id = ?',
                    [tableId]
                );
                if (tables.length > 0) {
                    const config = JSON.parse(tables[0].config);
                    table = new BlackjackTable(config);
                    table.id = tableId;
                    this.tables.set(tableId, table);
                }
            } finally {
                conn.release();
            }
        }
    }

    console.log('Returning table:', table?.id);
    return table?.id;
}

  async addPlayerToTable(tableId, playerId) {
    const table = this.tables.get(tableId);
    if (!table) {
      throw new Error("Table not found");
    }

    console.log(`adding player ${playerId} to table ${tableId}`);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // First check if player has any active positions at this table
      const [existingPositions] = await conn.execute(
        "SELECT id FROM player_positions WHERE table_id = ? AND user_id = ? AND status = ?",
        [tableId, playerId, "active"]
      );

      if (existingPositions.length > 0) {
        // Instead of throwing error, mark old position as inactive and create new one
        await conn.execute(
          "UPDATE player_positions SET status = ?, left_at = CURRENT_TIMESTAMP WHERE id = ?",
          ["left", existingPositions[0].id]
        );
      }

      // Remove from memory if exists in any table
      for (const [id, existingTable] of this.tables.entries()) {
        console.log(`Removing player ${id} from table`, existingTable);
        if (existingTable.players.has(playerId)) {
          existingTable.removePlayer(playerId);
        }
      }

      // Create new position
      const [result] = await conn.execute(
        "INSERT INTO player_positions (table_id, user_id, position, status) VALUES (?, ?, ?, ?)",
        [tableId, playerId, table.players.size, "active"]
      );

      const positionId = result.insertId;

      // Add to table's memory
      const success = table.addPlayer(playerId);
      if (!success) {
        throw new Error("Could not add player to table memory");
      }

      // Get active game or create new one
      const activeGameId = await global.gameStateManager.getActiveGameId(
        tableId
      );
      if (activeGameId) {
        // Create hand for existing game
        await conn.execute(
          "INSERT INTO player_hands (game_id, player_position_id, cards, bet_amount, status) VALUES (?, ?, ?, ?, ?)",
          [activeGameId, positionId, "[]", 0, "betting"]
        );
      }

      await conn.commit();
      console.log(
        `Successfully added player ${playerId} to table at position ${positionId}`
      );
      return positionId;
    } catch (error) {
      await conn.rollback();
      console.error("Error adding player to table:", error);
      throw error;
    } finally {
      conn.release();
    }
  }

  async removePlayerFromTable(playerId, tableId) {
    const table = this.tables.get(tableId);
    if (table) {
      table.removePlayer(playerId);
      if (table.players.size === 0) {
        // Update table status in database
        const conn = await pool.getConnection();
        try {
          await conn.execute("UPDATE tables SET status = ? WHERE id = ?", [
            "inactive",
            tableId,
          ]);
          this.tables.delete(tableId);
        } catch (error) {
          console.error("Error updating table status:", error);
          throw error;
        } finally {
          conn.release();
        }
      }
    }
  }

  doDouble(table, player) {
    console.log(`Doubling down for player ${player.id}`, this);
    // Double the bet
    player.bet *= 2;
    // Draw one card and move to next player
    const doubleCard = table.drawCard();
    player.hands[player.currentHand].push(doubleCard);
    player.status = "standing";
  }

  doSplit(table, player) {
    console.log(`Doubling down for player ${player.id}`, this);

    // Validate player can split
    const hand = player.hands[player.currentHand];
    if (hand.length !== 2 || hand[0].value !== hand[1].value) {
      throw new Error("Can only split matching cards");
    }

    // Double the bet
    player.bet *= 2;

    // Create new hand
    const card1 = hand.pop();
    player.hands.push([card1]);

    // Draw new cards for both hands
    player.hands[0].push(table.drawCard());
    player.hands[1].push(table.drawCard());

    player.status = "standing";
  }

  // In tableManager.js
  async handlePlayerAction(tableId, gameId, playerId, action) {
    const table = this.tables.get(tableId);
    if (!table) {
      throw new Error("Table not found");
    }

    // Validate it's this player's turn
    if (table.currentPlayer !== playerId) {
      throw new Error("Not your turn");
    }

    const player = table.players.get(playerId);
    if (!player) {
      throw new Error("Player not found");
    }

    let card;
    let total;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // First get the player's position ID
      const [positions] = await conn.execute(
        "SELECT id FROM player_positions WHERE table_id = ? AND user_id = ? AND status = ?",
        [tableId, playerId, "active"]
      );

      if (positions.length === 0) {
        throw new Error("Player position not found");
      }

      const positionId = positions[0].id;

      // Now use the correct position ID in the update
      switch (action) {
        case "hit":
          // Draw a card and add it to player's current hand
          card = table.drawCard();
          console.log("Drew card:", card);
          player.hands[player.currentHand].push(card);

          // Update hand in database
          await conn.execute(
            "UPDATE player_hands SET cards = ? WHERE game_id = ? AND player_position_id = ?",
            [JSON.stringify(player.hands[player.currentHand]), gameId, playerId]
          );

          // Check for bust
          total = table.calculateHand(player.hands[player.currentHand]);
          if (total > 21) {
            player.status = "busted";
            await conn.execute(
              "UPDATE player_hands SET status = ? WHERE game_id = ? AND player_position_id = ?",
              ["busted", gameId, playerId]
            );
            this.moveToNextPlayer(table);
          }
          break;

        case "stand":
          player.status = "standing";
          await conn.execute(
            "UPDATE player_hands SET status = ? WHERE game_id = ? AND player_position_id = ?",
            ["standing", gameId, positionId]
          );
          this.moveToNextPlayer(table);
          break;

        case "double":
          if (player.hands[player.currentHand].length !== 2) {
            throw new Error("Can only double on initial two cards");
          }
          this.doDouble(table, player);
          break;

        case "split":
          this.doSplit(table, player);
          break;

        default:
          throw new Error("Invalid action");
      }

      // Check if we need to move to dealer's turn
      if (table.gamePhase === "dealer_turn") {
        await this.handleDealerTurn(table, gameId);
      }

      await conn.commit();

      // Broadcast updated state to all players at the table
      if (global.gameStateManager) {
        console.log("Broadcasting updated state after action:", action);
        await global.gameStateManager.broadcastTableState(tableId);
      }

      return table.getState();
    } catch (error) {
      await conn.rollback();
      console.error("Error handling player action:", error);
      throw error;
    } finally {
      conn.release();
    }
  }

  moveToNextPlayer(table) {
    console.log("moving to next player", this);
    const players = Array.from(table.players.values());
    const currentIndex = players.findIndex((p) => p.id === table.currentPlayer);

    // Try to find next active player
    let nextPlayer = null;
    for (let i = currentIndex + 1; i < players.length; i += 1) {
      if (players[i].status === "playing") {
        nextPlayer = players[i];
        break;
      }
    }

    if (nextPlayer) {
      table.currentPlayer = nextPlayer.id;
    } else {
      // No more players, move to dealer's turn
      table.gamePhase = "dealer_turn";
    }
  }

  async handleDealerTurn(table, gameId) {
    // Dealer draws until 17 or higher
    while (table.calculateHand(table.dealer.cards) < 17) {
      table.dealer.cards.push(table.drawCard());
    }

    // Update dealer cards in database
    const conn = await pool.getConnection();
    try {
      await conn.execute(
        "UPDATE games SET dealer_cards = ?, game_phase = ? WHERE id = ?",
        [JSON.stringify(table.dealer.cards), "completing", gameId]
      );

      // Handle game completion
      await this.completeGame(table, gameId);
    } finally {
      conn.release();
    }
  }

  async completeGame(table, gameId) {
    const dealerTotal = table.calculateHand(table.dealer.cards);
    const dealerBusted = dealerTotal > 21;
    let newGameId = null;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      console.log('Starting game completion transaction');

      // Get all player hands with a single query
      const [playerHands] = await conn.execute(
        `SELECT ph.id, ph.player_position_id, ph.cards, ph.bet_amount, 
                    pp.user_id, ph.status
             FROM player_hands ph 
             JOIN player_positions pp ON ph.player_position_id = pp.id 
             WHERE ph.game_id = ?`,
        [gameId]
      );

      const gameResults = [];

      // Calculate results
      for (const hand of playerHands) {
        const player = table.players.get(hand.user_id);
        if (!player) continue;

        const playerCards = JSON.parse(hand.cards);
        const playerTotal = table.calculateHand(playerCards);

        let outcome;
        let payout = 0;

        if (hand.status === 'busted') {
          outcome = 'lose';
        } else if (dealerBusted) {
          outcome = 'win';
          payout = hand.bet_amount * 2;
        } else if (playerTotal > dealerTotal) {
          outcome = 'win';
          payout = hand.bet_amount * 2;
        } else if (playerTotal < dealerTotal) {
          outcome = 'lose';
        } else {
          outcome = 'push';
          payout = hand.bet_amount;
        }

        gameResults.push({
          id: uuidv4(),
          gameId,
          handId: hand.id,
          outcome,
          payout
        });
      }

      // Insert game results in batch if any exist
      if (gameResults.length > 0) {
        console.log('Inserting game results:', gameResults);

        const placeholders = gameResults.map(() => '(?, ?, ?, ?, ?)').join(',');
        const insertValues = gameResults.flatMap(result => [
          result.id,
          result.gameId,
          result.handId,
          result.outcome,
          result.payout
        ]);

        await conn.execute(
          `INSERT INTO game_results 
                    (id, game_id, player_hand_id, outcome, payout_amount) 
                VALUES ${placeholders}`,
          insertValues
        );
      }

      // Update game status
      await conn.execute(
        'UPDATE games SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?',
        ['completed', gameId]
      );

      // Create new game in the same transaction
      newGameId = uuidv4();
      await conn.execute(
        'INSERT INTO games (id, table_id, game_phase) VALUES (?, ?, ?)',
        [newGameId, table.id, 'betting']
      );

      // Create hands for all active positions
      const [positions] = await conn.execute(
        'SELECT * FROM player_positions WHERE table_id = ? AND status = ?',
        [table.id, 'active']
      );

      if (positions.length > 0) {
        const handInserts = positions.map(position => [
          newGameId,
          position.id,
          '[]',
          0,
          'betting'
        ]);

        const handPlaceholders = positions.map(() => '(?, ?, ?, ?, ?)').join(',');
        await conn.execute(
          `INSERT INTO player_hands 
                    (game_id, player_position_id, cards, bet_amount, status)
                VALUES ${handPlaceholders}`,
          handInserts.flat()
        );
      }

      await conn.commit();
      console.log('Game completion transaction successful');

      // Reset table state
      table.gamePhase = 'betting';
      table.currentPlayer = null;
      table.dealer.cards = [];

      for (const player of table.players.values()) {
        player.hands = [
          []
        ];
        player.currentHand = 0;
        player.bet = 0;
        player.status = 'betting';
      }

      // Broadcast updated state
      if (global.gameStateManager) {
        await global.gameStateManager.broadcastTableState(table.id);
      }

      return newGameId;

    } catch (error) {
      console.error('Error in completeGame transaction:', error);
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }


}

module.exports = {
  TableManager,
};
