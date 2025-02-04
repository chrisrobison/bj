/* eslint-disable class-methods-use-this */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-unused-vars */
/* eslint-disable no-plusplus */
// server/gameStateManager.js
const { v4: uuidv4 } = require('uuid');
const pool = require('./db');
const { BlackjackTable } = require('./blackjackTable');

class GameStateManager {
  constructor() {
    this.activeGames = new Map();
    this.activeTables = new Map();
  }

  async createTable(config) {
    const conn = await pool.getConnection();
    try {
      const tableId = uuidv4();
      await conn.execute(
        'INSERT INTO tables (id, config) VALUES (?, ?)',
        [tableId, JSON.stringify(config)],
      );

      // Create in-memory table state
      const table = new BlackjackTable(tableId, config);
      this.activeTables.set(tableId, table);

      return table;
    } finally {
      conn.release();
    }
  }

  trackTable(tableId, table) {
    if (!this.activeTables.has(tableId)) {
      this.activeTables.set(tableId, table);
    }
    return table;
  }

  async getTableState(tableId) {
    const table = this.activeTables.get(tableId);
    if (!table) {
      throw new Error('Table not found');
    }

    console.log('Getting table state for phase:', table.gamePhase);

    return {
      tableId,
      config: table.config,
      gamePhase: table.gamePhase,
      currentPlayer: table.currentPlayer,
      dealer: {
        cards: [...table.dealer.cards], // Make a copy
      },
      players: Array.from(table.players.entries()).map(([id, player]) => ({
        id,
        hands: player.hands.map((hand) => [...hand]), // Deep copy of hands
        currentHand: player.currentHand,
        bet: player.bet,
        status: player.status,
      })),
    };
  }

  async getPlayerView(tableId, playerId, state) {
    // Clone the state to avoid modifying the original
    const playerView = JSON.parse(JSON.stringify(state));

    console.log(this.status);

    // Hide dealer's hole card during play if necessary
    if (playerView.gamePhase === 'playing' && playerView.dealer.cards.length > 1) {
      playerView.dealer.cards[1] = { hidden: true };
    }

    // Only send the face-up card during betting/playing phases
    if ((playerView.gamePhase === 'playing' || playerView.gamePhase === 'betting') && playerView.dealer.cards.length > 0) {
      // Only send the first card, completely omit the second
      playerView.dealer.cards = [playerView.dealer.cards[0]];
    }

    // Add any player-specific information
    const player = playerView.players.find((p) => p.id === playerId);
    if (player) {
      player.isCurrentPlayer = (state.currentPlayer === playerId);
    }

    return playerView;
  }

  async getActiveGameId(tableId) {
    // Find the active game for this table
    const activeGameEntry = Array.from(this.activeGames.entries())
        .find(([, game]) => game.tableId === tableId);
    
    return activeGameEntry ? activeGameEntry[0] : null;
  }

  async addPlayerToTable(tableId, userId, position) {
    const conn = await pool.getConnection();
    try {
      const result = await conn.execute(
        'INSERT INTO player_positions (table_id, user_id, position) VALUES (?, ?, ?, ?)',
        [tableId, userId, position],
      );

      // Get the auto-generated ID from the insert result
      const positionId = result.insertId;

      // Update in-memory state
      const table = this.activeTables.get(tableId);
      if (table) {
        table.addPlayer(userId, position);
      }

      return positionId;
    } finally {
      conn.release();
    }
  }

  // In gameStateManager.js
  async startNewGame(tableId) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Generate game ID
      const gameId = uuidv4();

      // Create new game
      await conn.execute(
        'INSERT INTO games (id, table_id, game_phase) VALUES (?, ?, ?)',
        [gameId, tableId, 'betting'],
      );

      // Get all active positions in one query
      const [positions] = await conn.execute(
        'SELECT * FROM player_positions WHERE table_id = ? AND status = ?',
        [tableId, 'active'],
      );

      // Prepare all hand insertions at once
      if (positions.length > 0) {
        // Create the bulk insert query
        const insertValues = positions.map((position) => [gameId, position.id, '[]', 0, 'betting']);

        // Build the bulk insert query
        const placeholders = positions.map(() => '(?, ?, ?, ?, ?)').join(', ');
        const query = `INSERT INTO player_hands 
                (game_id, player_position_id, cards, bet_amount, status) 
                VALUES ${placeholders}`;

        // Flatten the array of values for the bulk insert
        const flatValues = insertValues.flat();

        // Execute bulk insert
        await conn.execute(query, flatValues);
      }

      await conn.commit();

      // Update in-memory state
      const game = {
        id: gameId,
        tableId,
        phase: 'betting',
        playerHands: new Map(),
        dealerCards: [],
      };
      this.activeGames.set(gameId, game);

      return gameId;
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async updateGamePhase(tableId, phase) {
    console.log(`Updating game phase for table ${tableId} to ${phase}`);
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Get active game
      const gameId = await this.getActiveGameId(tableId);
      if (!gameId) {
        throw new Error('No active game found');
      }

      // Update game phase in database
      await conn.execute(
        'UPDATE games SET game_phase = ? WHERE id = ?',
        [phase, gameId],
      );

      // Update in-memory state
      const table = this.activeTables.get(tableId);
      if (table) {
        table.gamePhase = phase;
      }

      await conn.commit();

      // Get and broadcast updated state
      const state = await this.getTableState(tableId);

      console.log('Broadcasting updated state after phase change:', state);
      this.broadcastTableState(tableId);
    } catch (error) {
      await conn.rollback();
      console.error('Error updating game phase:', error);
      throw error;
    } finally {
      conn.release();
    }
  }

  async broadcastTableState(tableId) {
    console.log(`Broadcasting state for table ${tableId}`);
    try {
      const state = await this.getTableState(tableId);
      console.log('State to broadcast:', state);

      if (!global.clients) {
        console.error('No clients map available');
        return;
      }

      // Get array of WebSocket clients for this table
      const tableClients = Array.from(global.clients.entries())
        .filter(([, client]) => client.tableId === tableId);

      // Create array of promises for all client broadcasts
      const broadcastPromises = tableClients.map(async ([ws, client]) => {
        try {
          const playerView = await this.getPlayerView(tableId, client.id, state);
          console.log(`Sending state to player ${client.id}:`, playerView);
          ws.send(JSON.stringify({
            type: 'state_update',
            data: playerView,
          }));
        } catch (error) {
          console.error(`Error sending state to client ${client.id}:`, error);
        }
      });

      // Wait for all broadcasts to complete
      await Promise.all(broadcastPromises);
    } catch (error) {
      console.error('Error broadcasting table state:', error);

      // Notify all clients at the table about the error
      const tableClients = Array.from(global.clients.entries())
        .filter(([, client]) => client.tableId === tableId);

      // Send error messages in parallel
      const errorPromises = tableClients.map(([ws, _]) => {
        let p;
        try {
          p = ws.send(JSON.stringify({
            type: 'error',
            message: `Error updating game state: ${_}`,
          }));
        } catch (sendError) {
          console.error('Error sending error message:', sendError);
        }
        return p;
      });

      await Promise.all(errorPromises);
    }
  }

  async placeBet(gameId, playerPositionId, amount) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Update bet amount in database
      await conn.execute(
        'UPDATE player_hands SET bet_amount = ?, status = ? WHERE game_id = ? AND player_position_id = ?',
        [amount, 'playing', gameId, playerPositionId],
      );

      // Check if all players have bet
      const [hands] = await conn.execute(
        'SELECT status FROM player_hands WHERE game_id = ?',
        [gameId],
      );

      const allBetsPlaced = hands.every((hand) => hand.status !== 'betting');
      if (allBetsPlaced) {
        await conn.execute(
          'UPDATE games SET game_phase = ? WHERE id = ?',
          ['dealing', gameId],
        );
      }

      await conn.commit();

      // Update in-memory state
      const game = this.activeGames.get(gameId);
      if (game) {
        const hand = game.playerHands.get(playerPositionId) || {};
        hand.betAmount = amount;
        hand.status = 'playing';
        game.playerHands.set(playerPositionId, hand);

        if (allBetsPlaced) {
          game.phase = 'dealing';
        }
      }
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async dealCards(gameId, dealerCards, playerCards) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Update dealer cards
      await conn.execute(
        'UPDATE games SET dealer_cards = ?, game_phase = ? WHERE id = ?',
        [JSON.stringify(dealerCards), 'player_turns', gameId],
      );

      // Create array of all player card update promises
      if (Object.entries(playerCards).length > 0) {
        // Build the bulk update query
        const updates = Object.entries(playerCards).map(([positionId, cards]) => ({
          cards: JSON.stringify(cards),
          gameId,
          positionId,
        }));

        // Create a CASE statement for bulk update
        const cases = updates.map((_, index) => 'WHEN player_position_id = ? THEN ?').join(' ');

        // Flatten values for the query
        const values = updates.flatMap((update) => [
          update.positionId,
          update.cards,
        ]);

        // Build and execute single bulk update query
        const query = `
                UPDATE player_hands 
                SET cards = CASE 
                    ${cases}
                END
                WHERE game_id = ? AND player_position_id IN (${updates.map(() => '?').join(',')})
            `;

        await conn.execute(query, [
          ...values,
          gameId,
          ...updates.map((u) => u.positionId),
        ]);
      }

      await conn.commit();

      // Update in-memory state
      const game = this.activeGames.get(gameId);
      if (game) {
        game.dealerCards = dealerCards;
        game.phase = 'player_turns';

        // Update all player hands at once
        Object.entries(playerCards).forEach(([positionId, cards]) => {
          const hand = game.playerHands.get(positionId) || {};
          hand.cards = cards;
          game.playerHands.set(positionId, hand);
        });
      }
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async handlePlayerAction(gameId, playerPositionId, action, actionData) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      switch (action) {
        case 'hit':
          await this.handleHit(conn, gameId, playerPositionId, actionData.card);
          break;
        case 'stand':
          await this.handleStand(conn, gameId, playerPositionId);
          break;
        case 'split':
          await this.handleSplit(conn, gameId, playerPositionId);
          break;
        case 'double':
          await this.handleDouble(conn, gameId, playerPositionId, actionData.card);
          break;
        default:
          break;
      }

      // Check if all players are done
      const [hands] = await conn.execute(
        'SELECT status FROM player_hands WHERE game_id = ?',
        [gameId],
      );

      const allPlayersDone = hands.every((hand) => ['standing', 'busted', 'blackjack'].includes(hand.status));

      if (allPlayersDone) {
        await conn.execute(
          'UPDATE games SET game_phase = ? WHERE id = ?',
          ['dealer_turn', gameId],
        );
      }

      await conn.commit();

      // Update in-memory state accordingly
      this.updateGameState(gameId);
    } catch (error) {
      await conn.rollback();
      throw error;
    } finally {
      conn.release();
    }
  }

  async completeGame(gameId, results) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        // Prepare bulk insert for game results
        if (results.length > 0) {
            // Create the bulk insert query
            const placeholders = results.map(() => '(?, ?, ?, ?, ?)').join(', ');
            const query = `INSERT INTO game_results 
                (id, game_id, player_hand_id, outcome, payout_amount) 
                VALUES ${placeholders}`;

            // Prepare values for bulk insert
            const values = results.flatMap(result => [
                uuidv4(),
                gameId,
                result.handId,
                result.outcome,
                result.payout
            ]);

            // Execute bulk insert
            await conn.execute(query, values);
        }

        // Update game status
        await conn.execute(
            'UPDATE games SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?',
            ['completed', gameId]
        );

        await conn.commit();

        // Clean up in-memory state
        this.activeGames.delete(gameId);

    } catch (error) {
        await conn.rollback();
        throw error;
    } finally {
        conn.release();
    }
}

  // Helper methods for handling specific actions
  async handleHit(conn, gameId, playerPositionId, card) {
    const [hand] = await conn.execute(
      'SELECT cards FROM player_hands WHERE game_id = ? AND player_position_id = ?',
      [gameId, playerPositionId],
    );

    const cards = JSON.parse(hand[0].cards);
    cards.push(card);

    const total = this.calculateHandTotal(cards);
    const status = total > 21 ? 'busted' : 'playing';

    await conn.execute(
      'UPDATE player_hands SET cards = ?, status = ? WHERE game_id = ? AND player_position_id = ?',
      [JSON.stringify(cards), status, gameId, playerPositionId],
    );
  }

  async handleStand(conn, gameId, playerPositionId) {
    await conn.execute(
      'UPDATE player_hands SET status = ? WHERE game_id = ? AND player_position_id = ?',
      ['standing', gameId, playerPositionId],
    );
  }

  async handleSplit(conn, gameId, playerPositionId) {
    // Implementation for split action
    // This would create a new hand record and update the original hand
  }

  async handleDouble(conn, gameId, playerPositionId, card) {
    // Implementation for double down action
    // This would update bet amount and add one final card
  }

  // Utility methods
  calculateHandTotal(cards) {
    return this.calculateHand(cards);
  }

  calculateHand(cards) {
    let total = 0;
    let aces = 0;

    for (const card of cards) {
      if (card.value === 1) {
        aces++;
      } else {
        total += Math.min(10, card.value);
      }
    }

    // Add aces
    for (let i = 0; i < aces; i++) {
      if (total + 11 <= 21) {
        total += 11;
      } else {
        total += 1;
      }
    }

    return total;
  }
}

module.exports = { GameStateManager };
