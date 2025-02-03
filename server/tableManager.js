/* eslint-disable prefer-destructuring */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-param-reassign */
/* eslint-disable no-plusplus */
/* eslint-disable class-methods-use-this */
// tableManager.js
const { v4: uuidv4 } = require('uuid');
const BlackjackTable = require('./blackjackTable');
const pool = require('./db');

class TableManager {
  constructor() {
    console.log('Initializing TableManager');
    this.tables = new Map(); // Initialize the tables Map
    console.log('TableManager initialized');
  }

  async placeBet(tableId, playerId, amount) {
    console.log('TableManager.placeBet called:', { tableId, playerId, amount });

    const table = this.tables.get(tableId);
    if (!table) {
      throw new Error('Table not found');
    }

    // Validate bet amount against table limits
    if (amount < table.config.minBet || amount > table.config.maxBet) {
      throw new Error(
        `Bet must be between ${table.config.minBet} and ${table.config.maxBet}`,
      );
    }

    let positionId;
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Get or create player position
      const [positions] = await conn.execute(
        'SELECT id FROM player_positions WHERE table_id = ? AND user_id = ? AND status = ?',
        [tableId, playerId, 'active'],
      );

      if (positions.length === 0) {
        const [result] = await conn.execute(
          'INSERT INTO player_positions (table_id, user_id, position, status) VALUES (?, ?, ?, ?)',
          [tableId, playerId, table.players.size, 'active'],
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
        'UPDATE player_hands SET bet_amount = ?, status = ? WHERE game_id = ? AND player_position_id = ?',
        [amount, 'ready', activeGameId, positionId],
      );

      // Update in-memory state
      const player = table.players.get(playerId);
      if (player) {
        player.bet = amount;
        player.status = 'ready';
      }

      // Check if all players are ready
      const allPlayersReady = Array.from(table.players.values()).every(
        (p) => p.status === 'ready',
      );

      if (allPlayersReady) {
        console.log('All players ready, starting new round');
        const newState = await table.startRound();

        // Make sure the state gets broadcast
        if (global.gameStateManager) {
          await global.gameStateManager.broadcastTableState(tableId);
        }

        console.log('New game state after starting round:', newState);
      }

      await conn.commit();
      return true;
    } catch (error) {
      await conn.rollback();
      console.error('Error in placeBet:', error);
      throw error;
    } finally {
      conn.release();
    }
  }

  async createTable(config) {
    console.log('Creating new table with config:', config);
    const table = new BlackjackTable(config);

    // First persist to database
    const conn = await pool.getConnection();
    try {
      console.log('Persisting table to database:', table.id);
      await conn.execute(
        'INSERT INTO tables (id, config, status) VALUES (?, ?, ?)',
        [table.id, JSON.stringify(config), 'active'],
      );

      // Store the table in our Map only after successful database insert
      this.tables.set(table.id, table);
      console.log(`Table ${table.id} created and stored in both DB and memory`);

      return table;
    } catch (error) {
      console.error('Error creating table in database:', error);
      throw error;
    } finally {
      conn.release();
    }
  }

  getTable(tableId) {
    console.log('Getting table:', tableId);
    console.log('Available tables:', Array.from(this.tables.keys()));
    return this.tables.get(tableId);
  }

  async findAvailableTable() {
    console.log('Finding available table');
    console.log('Current tables:', Array.from(this.tables.entries()));
    return Array.from(this.tables.values()).find(
      (table) => table.players.size < table.config.maxPlayers,
    );
  }

  async findOrCreateTable() {
    console.log('Finding or creating table');
    let table = await this.findAvailableTable();

    if (!table) {
      console.log('No available table found, creating new one');
      const defaultConfig = {
        decks: 6,
        continuousShuffle: true,
        maxPlayers: 5,
        minBet: 1,
        maxBet: 500,
        doubleDown: 'any',
        doubleAfterSplit: true,
        dealerHitSoft17: true,
      };
      table = await this.createTable(defaultConfig);
    }

    console.log('Returning table:', table.id);
    return table.id;
  }

  async addPlayerToTable(tableId, playerId) {
    const table = this.tables.get(tableId);
    if (!table) {
      throw new Error('Table not found');
    }

    console.log(`adding player ${playerId} to table ${tableId}`);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // First check if player has any active positions at this table
      const [existingPositions] = await conn.execute(
        'SELECT id FROM player_positions WHERE table_id = ? AND user_id = ? AND status = ?',
        [tableId, playerId, 'active'],
      );

      if (existingPositions.length > 0) {
        // Instead of throwing error, mark old position as inactive and create new one
        await conn.execute(
          'UPDATE player_positions SET status = ?, left_at = CURRENT_TIMESTAMP WHERE id = ?',
          ['left', existingPositions[0].id],
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
        'INSERT INTO player_positions (table_id, user_id, position, status) VALUES (?, ?, ?, ?)',
        [tableId, playerId, table.players.size, 'active'],
      );

      const positionId = result.insertId;

      // Add to table's memory
      const success = table.addPlayer(playerId);
      if (!success) {
        throw new Error('Could not add player to table memory');
      }

      // Get active game or create new one
      const activeGameId = await global.gameStateManager.getActiveGameId(tableId);
      if (activeGameId) {
        // Create hand for existing game
        await conn.execute(
          'INSERT INTO player_hands (game_id, player_position_id, cards, bet_amount, status) VALUES (?, ?, ?, ?, ?)',
          [activeGameId, positionId, '[]', 0, 'betting'],
        );
      }

      await conn.commit();
      console.log(
        `Successfully added player ${playerId} to table at position ${positionId}`,
      );
      return positionId;
    } catch (error) {
      await conn.rollback();
      console.error('Error adding player to table:', error);
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
          await conn.execute('UPDATE tables SET status = ? WHERE id = ?', [
            'inactive',
            tableId,
          ]);
          this.tables.delete(tableId);
        } catch (error) {
          console.error('Error updating table status:', error);
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
    player.status = 'standing';
  }

  doSplit(table, player) {
    console.log(`Doubling down for player ${player.id}`, this);

    // Validate player can split
    const hand = player.hands[player.currentHand];
    if (hand.length !== 2 || hand[0].value !== hand[1].value) {
      throw new Error('Can only split matching cards');
    }

    // Double the bet
    player.bet *= 2;

    // Create new hand
    const card1 = hand.pop();
    player.hands.push([card1]);

    // Draw new cards for both hands
    player.hands[0].push(table.drawCard());
    player.hands[1].push(table.drawCard());

    player.status = 'standing';
  }

  async handlePlayerAction(tableId, gameId, playerId, action) {
    const table = this.tables.get(tableId);
    if (!table) {
      throw new Error('Table not found');
    }

    // Validate it's this player's turn
    if (table.currentPlayer !== playerId) {
      throw new Error('Not your turn');
    }

    const player = table.players.get(playerId);
    if (!player) {
      throw new Error('Player not found');
    }

    let card;
    let total;

    // Handle different actions
    switch (action) {
      case 'hit':
        // Draw a card and add it to player's current hand
        card = table.drawCard();
        player.hands[player.currentHand].push(card);

        // Check for bust
        total = table.calculateHand(player.hands[player.currentHand]);
        if (total > 21) {
          player.status = 'busted';
          this.moveToNextPlayer(table);
        }
        break;

      case 'stand':
        player.status = 'standing';
        this.moveToNextPlayer(table);
        break;

      case 'double':
        // Validate player can double
        if (player.hands[player.currentHand].length !== 2) {
          throw new Error('Can only double on initial two cards');
        }

        this.doDouble(table, player);
        this.moveToNextPlayer(table);

        break;

      case 'split':
        this.doSplit(table, player);
        break;

      default:
        throw new Error('Invalid action');
    }

    // Update game state in database
    const conn = await pool.getConnection();
    try {
      await conn.execute(
        'UPDATE player_hands SET cards = ?, status = ? WHERE game_id = ? AND player_position_id = ?',
        [
          JSON.stringify(player.hands[player.currentHand]),
          player.status,
          gameId,
          playerId,
        ],
      );

      if (table.gamePhase === 'dealer_turn') {
        await this.handleDealerTurn(table, gameId);
      }
    } finally {
      conn.release();
    }

    return table.getState();
  }

  moveToNextPlayer(table) {
    console.log('moving to next player', this);
    const players = Array.from(table.players.values());
    const currentIndex = players.findIndex((p) => p.id === table.currentPlayer);

    // Try to find next active player
    let nextPlayer = null;
    for (let i = currentIndex + 1; i < players.length; i += 1) {
      if (players[i].status === 'playing') {
        nextPlayer = players[i];
        break;
      }
    }

    if (nextPlayer) {
      table.currentPlayer = nextPlayer.id;
    } else {
      // No more players, move to dealer's turn
      table.gamePhase = 'dealer_turn';
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
        'UPDATE games SET dealer_cards = ?, game_phase = ? WHERE id = ?',
        [JSON.stringify(table.dealer.cards), 'completing', gameId],
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

    // Create array to store all results before DB insertion
    const gameResults = [];

    // Calculate results for each player first
    for (const player of table.players.values()) {
      for (let i = 0; i < player.hands.length; i++) {
        const playerTotal = table.calculateHand(player.hands[i]);
        let outcome;
        let payout = 0;

        if (player.status === 'busted') {
          outcome = 'lose';
        } else if (dealerBusted) {
          outcome = 'win';
          payout = player.bet * 2;
        } else if (playerTotal > dealerTotal) {
          outcome = 'win';
          payout = player.bet * 2;
        } else if (playerTotal < dealerTotal) {
          outcome = 'lose';
        } else {
          outcome = 'push';
          payout = player.bet;
        }

        // Store result in array instead of immediate DB insertion
        gameResults.push({
          id: uuidv4(),
          gameId,
          playerId: player.id,
          outcome,
          payout,
        });
      }
    }

    // Single database connection to handle all results
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Insert all results in a single transaction
      const insertPromises = gameResults.map((result) => conn.execute(
        'INSERT INTO game_results (id, game_id, player_hand_id, outcome, payout_amount) VALUES (?, ?, ?, ?, ?)',
        [result.id, result.gameId, result.playerId, result.outcome, result.payout],
      ));

      await Promise.all(insertPromises);
      await conn.commit();
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }

    // Reset table for next round - keep this part as is
    table.gamePhase = 'betting';
    table.currentPlayer = null;
    table.dealer.cards = [];

    for (const player of table.players.values()) {
      player.hands = [[]];
      player.currentHand = 0;
      player.bet = 0;
      player.status = 'betting';
    }

    // Reset table for next round
    table.gamePhase = 'betting';
    table.currentPlayer = null;
    table.dealer.cards = [];

    for (const player of table.players.values()) {
      player.hands = [[]];
      player.currentHand = 0;
      player.bet = 0;
      player.status = 'betting';
    }
  }
}

module.exports = { TableManager };
