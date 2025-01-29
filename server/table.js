// server/table.js
class BlackjackTable {
    constructor(config) {
        this.id = Math.random().toString(36).substr(2, 9);
        this.config = {
            decks: config.decks || 6,
            continuousShuffle: config.continuousShuffle || true,
            maxPlayers: config.maxPlayers || 5,
            minBet: config.minBet || 1,
            maxBet: config.maxBet || 500,
            doubleDown: config.doubleDown || 'any',
            doubleAfterSplit: config.doubleAfterSplit || true,
            dealerHitSoft17: config.dealerHitSoft17 || true
        };

        this.shoe = [];
        this.players = new Map();
        this.dealer = {
            cards: [],
            total: 0
        };
        this.gamePhase = 'betting'; // betting, dealing, playing, completing
        this.currentPlayer = null;
        this.burnCard = null;

        this.initShoe();
    }

    initShoe() {
        this.shoe = [];
        const suits = ['H', 'D', 'S', 'C'];
        const values = Array.from({ length: 13 }, (_, i) => i + 1);

        for (let d = 0; d < this.config.decks; d++) {
            for (const suit of suits) {
                for (const value of values) {
                    this.shoe.push({ value, suit });
                }
            }
        }

        this.shuffle();
        this.burnCard = this.shoe.pop();
    }

    shuffle() {
        for (let i = this.shoe.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.shoe[i], this.shoe[j]] = [this.shoe[j], this.shoe[i]];
        }
    }

    addPlayer(playerId) {
        if (this.players.size >= this.config.maxPlayers) {
            return false;
        }

        this.players.set(playerId, {
            id: playerId,
            hands: [[]],
            currentHand: 0,
            bet: 0,
            status: 'betting'
        });

        return true;
    }

    removePlayer(playerId) {
        return this.players.delete(playerId);
    }

    getState() {
        return {
            id: this.id,
            config: this.config,
            gamePhase: this.gamePhase,
            currentPlayer: this.currentPlayer,
            dealer: this.dealer,
            players: Array.from(this.players.entries()).map(([id, player]) => ({
                id,
                hands: player.hands,
                currentHand: player.currentHand,
                bet: player.bet,
                status: player.status
            }))
        };
    }

    getPlayerView(playerId, state) {
        const view = { ...state };
        // Hide dealer's hole card during play
        if (this.gamePhase === 'playing') {
            view.dealer = {
                ...view.dealer,
                cards: [view.dealer.cards[0], { hidden: true }]
            };
        }
        return view;
    }


    placeBet(playerId, amount) {
        const player = this.players.get(playerId);
        if (!player) {
            return false;
        }

        // Validate betting phase
        if (this.gamePhase !== 'betting') {
            return false;
        }

        // Place the bet
        player.bet = amount;
        player.status = 'ready';

        // Check if all players have bet and start dealing if so
        const allPlayersReady = Array.from(this.players.values())
            .every(p => p.status === 'ready');

        if (allPlayersReady) {
            this.startRound();
        }

        return true;
    }

    startRound() {
        this.gamePhase = 'dealing';

        // Reset dealer's hand
        this.dealer.cards = [];

        // Deal initial cards
        for (let i = 0; i < 2; i++) {
            // Deal to players first
            for (const player of this.players.values()) {
                player.hands[0].push(this.drawCard());
            }
            // Then to dealer
            this.dealer.cards.push(this.drawCard());
        }

        this.gamePhase = 'playing';
        // Set first player as current
        this.currentPlayer = Array.from(this.players.keys())[0];

        // Update player statuses
        for (const player of this.players.values()) {
            player.status = 'playing';
        }

        // Check for dealer blackjack
        if (this.calculateHand(this.dealer.cards) === 21) {
            this.completeRound();
        }
    }

    drawCard() {
        if (this.shoe.length === 0) {
            this.initShoe();
        }
        return this.shoe.pop();
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

    completeRound() {
        this.gamePhase = 'completing';
        // Reveal dealer's cards
        while (this.calculateHand(this.dealer.cards) < 17) {
            this.dealer.cards.push(this.drawCard());
        }

        const dealerTotal = this.calculateHand(this.dealer.cards);

        // Compare hands and settle bets
        for (const player of this.players.values()) {
            for (const hand of player.hands) {
                const playerTotal = this.calculateHand(hand);
                // Logic for determining winner would go here
            }
        }

        // Reset for next round
        this.gamePhase = 'betting';
        this.currentPlayer = null;

        // Reset player hands and status
        for (const player of this.players.values()) {
            player.hands = [[]];
            player.currentHand = 0;
            player.bet = 0;
            player.status = 'betting';
        }
    }
}

const pool = require('./db');

class TableManager {
    constructor() {
        this.tables = new Map();
    }

    async placeBet(tableId, playerId, amount) {
        const table = this.tables.get(tableId);
        if (!table) {
            throw new Error('Table not found');
        }

        // Validate bet amount against table limits
        if (amount < table.config.minBet || amount > table.config.maxBet) {
            throw new Error(`Bet must be between ${table.config.minBet} and ${table.config.maxBet}`);
        }

        // Place the bet
        const success = table.placeBet(playerId, amount);
        if (!success) {
            throw new Error('Could not place bet. Check game phase and player status.');
        }

        // Record the bet in the database
        const conn = await pool.getConnection();
        try {
            const activeGame = await global.gameStateManager.getActiveGameId(tableId);
            if (!activeGame) {
                throw new Error('No active game found');
            }

            await conn.execute(
                'UPDATE player_hands SET bet_amount = ?, status = ? WHERE game_id = ? AND player_position_id = ?',
                [amount, 'ready', activeGame, playerId]
            );

            return true;
        } catch (error) {
            console.error('Error recording bet:', error);
            throw error;
        } finally {
            conn.release();
        }
    }

    async createTable(config) {
        const table = new BlackjackTable(config);
        
        // First persist to database
        const conn = await pool.getConnection();
        try {
            await conn.execute(
                'INSERT INTO tables (id, config, status) VALUES (?, ?, ?)',
                [table.id, JSON.stringify(config), 'active']
            );
            
            this.tables.set(table.id, table);
            
            // Register with GameStateManager
            if (global.gameStateManager) {
                global.gameStateManager.trackTable(table.id, table);
            }
            
            return table;
        } catch (error) {
            console.error('Error creating table:', error);
            throw error;
        } finally {
            conn.release();
        }
    }

    getTable(tableId) {
        return this.tables.get(tableId);
    }

    async findAvailableTable() {
        return Array.from(this.tables.values())
            .find(table => table.players.size < table.config.maxPlayers);
    }

    async findOrCreateTable() {
        let table = await this.findAvailableTable();
        if (!table) {
            // Use default config if none provided
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
            table = await this.createTable(defaultConfig);
        }
        return table.id;
    }

    async addPlayerToTable(tableId, playerId) {
        const table = this.tables.get(tableId);
        if (!table) {
            throw new Error('Table not found');
        }
        
        console.log(`adding player ${playerId} to table ${tableId}`);

        // Check if player is already at another table
        for (const [id, existingTable] of this.tables.entries()) {
            if (existingTable.players.has(playerId)) {
                if (id === tableId) {
                    throw new Error('Player already at this table');
                } else {
                    // Remove from other table first
                    this.removePlayerFromTable(playerId, id);
                }
            }
        }

        // Add player to table
        const success = table.addPlayer(playerId);
        if (!success) {
            throw new Error('Could not add player to table');
        }
        
        // Find the player's position
        const position = Array.from(table.players.entries())
            .find(([_, player]) => player.id === playerId);
        
        console.log(`successfully added player to table position ${position}`);
        return position ? position[0] : null;
    }

    async removePlayerFromTable(playerId, tableId) {
        const table = this.tables.get(tableId);
        if (table) {
            table.removePlayer(playerId);
            if (table.players.size === 0) {
                // Update table status in database
                const conn = await pool.getConnection();
                try {
                    await conn.execute(
                        'UPDATE tables SET status = ? WHERE id = ?',
                        ['inactive', tableId]
                    );
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
}

module.exports = { BlackjackTable, TableManager };
