// server/gameStateManager.js
const { v4: uuidv4 } = require('uuid');
const pool = require('./db');

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
                [tableId, JSON.stringify(config)]
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

        const activeGameId = await this.getActiveGameId(tableId);
        const activeGame = this.activeGames.get(activeGameId);

        return {
            tableId: tableId,
            config: table.config,
            gamePhase: activeGame ? activeGame.phase : 'betting',
            dealer: {
                cards: activeGame ? activeGame.dealerCards : []
            },
            players: Array.from(table.players.entries()).map(([playerId, player]) => {
                const playerHand = activeGame ? activeGame.playerHands.get(playerId) : null;
                return {
                    id: playerId,
                    hands: player.hands,
                    currentHand: player.currentHand,
                    bet: playerHand ? playerHand.betAmount : 0,
                    status: player.status
                };
            })
        };
    }

    async getPlayerView(tableId, playerId, state) {
        // Clone the state to avoid modifying the original
        const playerView = JSON.parse(JSON.stringify(state));

        // Hide dealer's hole card during play if necessary
        if (playerView.gamePhase === 'playing' && playerView.dealer.cards.length > 1) {
            playerView.dealer.cards[1] = { hidden: true };
        }

        // Add any player-specific information
        const player = playerView.players.find(p => p.id === playerId);
        if (player) {
            player.isCurrentPlayer = (state.currentPlayer === playerId);
        }

        return playerView;
    }

    async getActiveGameId(tableId) {
        // Find the active game for this table
        return Array.from(this.activeGames.entries())
            .find(([_, game]) => game.tableId === tableId)?.[0] || null;
    }

    async startNewGame(tableId) {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const gameId = uuidv4();
            await conn.execute(
                'INSERT INTO games (id, table_id, game_phase) VALUES (?, ?, ?)',
                [gameId, tableId, 'betting']
            );

            // Create player hands for all active positions
            const [positions] = await conn.execute(
                'SELECT * FROM player_positions WHERE table_id = ? AND status = ?',
                [tableId, 'active']
            );

            for (const position of positions) {
                await conn.execute(
                    'INSERT INTO player_hands (id, game_id, player_position_id, cards, bet_amount, status) VALUES (?, ?, ?, ?, ?, ?)',
                    [uuidv4(), gameId, position.id, '[]', 0, 'betting']
                );
            }

            await conn.commit();

            // Update in-memory state
            const game = {
                id: gameId,
                tableId,
                phase: 'betting',
                playerHands: new Map(),
                dealerCards: []
            };
            this.activeGames.set(gameId, game);

            return game;
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    async addPlayerToTable(tableId, userId, position) {
        const conn = await pool.getConnection();
        try {
            const positionId = uuidv4();
            await conn.execute(
                'INSERT INTO player_positions (id, table_id, user_id, position) VALUES (?, ?, ?, ?)',
                [positionId, tableId, userId, position]
            );

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

    async startNewGame(tableId) {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const gameId = uuidv4();
            await conn.execute(
                'INSERT INTO games (id, table_id, game_phase) VALUES (?, ?, ?)',
                [gameId, tableId, 'betting']
            );

            // Create player hands for all active positions
            const [positions] = await conn.execute(
                'SELECT * FROM player_positions WHERE table_id = ? AND status = ?',
                [tableId, 'active']
            );

            for (const position of positions) {
                await conn.execute(
                    'INSERT INTO player_hands (id, game_id, player_position_id, cards, bet_amount, status) VALUES (?, ?, ?, ?, ?, ?)',
                    [uuidv4(), gameId, position.id, '[]', 0, 'betting']
                );
            }

            await conn.commit();

            // Update in-memory state
            const game = {
                id: gameId,
                tableId,
                phase: 'betting',
                playerHands: new Map(),
                dealerCards: []
            };
            this.activeGames.set(gameId, game);

            return game;
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    async placeBet(gameId, playerPositionId, amount) {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            // Update bet amount in database
            await conn.execute(
                'UPDATE player_hands SET bet_amount = ?, status = ? WHERE game_id = ? AND player_position_id = ?',
                [amount, 'playing', gameId, playerPositionId]
            );

            // Check if all players have bet
            const [hands] = await conn.execute(
                'SELECT status FROM player_hands WHERE game_id = ?',
                [gameId]
            );

            const allBetsPlaced = hands.every(hand => hand.status !== 'betting');
            if (allBetsPlaced) {
                await conn.execute(
                    'UPDATE games SET game_phase = ? WHERE id = ?',
                    ['dealing', gameId]
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
                [JSON.stringify(dealerCards), 'player_turns', gameId]
            );

            // Update player cards
            for (const [positionId, cards] of Object.entries(playerCards)) {
                await conn.execute(
                    'UPDATE player_hands SET cards = ? WHERE game_id = ? AND player_position_id = ?',
                    [JSON.stringify(cards), gameId, positionId]
                );
            }

            await conn.commit();

            // Update in-memory state
            const game = this.activeGames.get(gameId);
            if (game) {
                game.dealerCards = dealerCards;
                game.phase = 'player_turns';
                
                for (const [positionId, cards] of Object.entries(playerCards)) {
                    const hand = game.playerHands.get(positionId) || {};
                    hand.cards = cards;
                    game.playerHands.set(positionId, hand);
                }
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
            }

            // Check if all players are done
            const [hands] = await conn.execute(
                'SELECT status FROM player_hands WHERE game_id = ?',
                [gameId]
            );

            const allPlayersDone = hands.every(hand => 
                ['standing', 'busted', 'blackjack'].includes(hand.status)
            );

            if (allPlayersDone) {
                await conn.execute(
                    'UPDATE games SET game_phase = ? WHERE id = ?',
                    ['dealer_turn', gameId]
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

            // Record game results
            for (const result of results) {
                await conn.execute(
                    'INSERT INTO game_results (id, game_id, player_hand_id, outcome, payout_amount) VALUES (?, ?, ?, ?, ?)',
                    [uuidv4(), gameId, result.handId, result.outcome, result.payout]
                );
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
            [gameId, playerPositionId]
        );

        const cards = JSON.parse(hand[0].cards);
        cards.push(card);

        const total = this.calculateHandTotal(cards);
        const status = total > 21 ? 'busted' : 'playing';

        await conn.execute(
            'UPDATE player_hands SET cards = ?, status = ? WHERE game_id = ? AND player_position_id = ?',
            [JSON.stringify(cards), status, gameId, playerPositionId]
        );
    }

    async handleStand(conn, gameId, playerPositionId) {
        await conn.execute(
            'UPDATE player_hands SET status = ? WHERE game_id = ? AND player_position_id = ?',
            ['standing', gameId, playerPositionId]
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
        // Implementation of blackjack hand total calculation
    }

    updateGameState(gameId) {
        // Sync in-memory state with database
    }
}

module.exports = { GameStateManager };
