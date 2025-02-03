// server/adminHandler.js
const pool = require('./db');

class AdminHandler {
    static async getDashboardStats() {
        const conn = await pool.getConnection();
        try {
            // Get active tables count
            const [tableResult] = await conn.execute(
                'SELECT COUNT(*) as count FROM tables WHERE status = ?',
                ['active']
            );

            // Get active players count
            const [playerResult] = await conn.execute(
                'SELECT COUNT(DISTINCT user_id) as count FROM player_positions WHERE status = ?',
                ['active']
            );

            // Get today's bets total
            const [betsResult] = await conn.execute(
                `SELECT COALESCE(SUM(bet_amount), 0) as total 
                 FROM player_hands 
                 WHERE DATE(created_at) = CURDATE()`
            );

            // Get today's profit/loss
            const [plResult] = await conn.execute(
                `SELECT COALESCE(SUM(CASE 
                    WHEN outcome = 'win' THEN -payout_amount 
                    WHEN outcome = 'lose' THEN bet_amount
                    ELSE 0 
                END), 0) as profit_loss
                FROM game_results 
                WHERE DATE(created_at) = CURDATE()`
            );

            return {
                activeTables: tableResult[0].count,
                activePlayers: playerResult[0].count,
                totalBets: betsResult[0].total,
                profitLoss: plResult[0].profit_loss
            };
        } finally {
            conn.release();
        }
    }

    static async getActiveGames() {
        const conn = await pool.getConnection();
        try {
            const [games] = await conn.execute(
                `SELECT 
                    g.id,
                    g.table_id,
                    g.game_phase,
                    t.config,
                    COUNT(DISTINCT ph.player_position_id) as player_count,
                    COALESCE(SUM(ph.bet_amount), 0) as total_bets
                FROM games g
                JOIN tables t ON g.table_id = t.id
                LEFT JOIN player_hands ph ON g.id = ph.game_id
                WHERE g.status = 'active'
                GROUP BY g.id`
            );

            return games.map(game => ({
                id: game.id,
                tableId: game.table_id,
                phase: game.game_phase,
                playerCount: game.player_count,
                maxPlayers: JSON.parse(game.config).maxPlayers,
                totalBets: game.total_bets
            }));
        } finally {
            conn.release();
        }
    }

    static async getTables() {
        const conn = await pool.getConnection();
        try {
            const [tables] = await conn.execute(
                `SELECT 
                    t.*,
                    COUNT(DISTINCT pp.id) as player_count
                FROM tables t
                LEFT JOIN player_positions pp ON t.id = pp.table_id AND pp.status = 'active'
                GROUP BY t.id`
            );

            return tables.map(table => ({
                id: table.id,
                config: JSON.parse(table.config),
                status: table.status,
                playerCount: table.player_count,
                createdAt: table.created_at
            }));
        } finally {
            conn.release();
        }
    }

    static async createTable(config) {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const [result] = await conn.execute(
                'INSERT INTO tables (config, status) VALUES (?, ?)',
                [JSON.stringify(config), 'active']
            );

            await conn.commit();
            return result.insertId;
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    static async closeTable(tableId) {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            // Complete any active games
            await conn.execute(
                'UPDATE games SET status = ?, completed_at = CURRENT_TIMESTAMP WHERE table_id = ? AND status = ?',
                ['completed', tableId, 'active']
            );

            // Remove active players
            await conn.execute(
                'UPDATE player_positions SET status = ?, left_at = CURRENT_TIMESTAMP WHERE table_id = ? AND status = ?',
                ['left', tableId, 'active']
            );

            // Close the table
            await conn.execute(
                'UPDATE tables SET status = ? WHERE id = ?',
                ['inactive', tableId]
            );

            await conn.commit();
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    static async getPlayers(searchTerm = '') {
        const conn = await pool.getConnection();
        try {
            let query = `
                SELECT 
                    u.*,
                    COALESCE(b.amount, 0) as balance,
                    MAX(pp.updated_at) as last_active
                FROM users u
                LEFT JOIN balances b ON u.id = b.user_id
                LEFT JOIN player_positions pp ON u.id = pp.user_id
            `;

            const params = [];
            if (searchTerm) {
                query += ' WHERE u.username LIKE ? OR u.email LIKE ?';
                params.push(`%${searchTerm}%`, `%${searchTerm}%`);
            }

            query += ' GROUP BY u.id';
            const [players] = await conn.execute(query, params);

            return players.map(player => ({
                id: player.id,
                username: player.username,
                email: player.email,
                balance: player.balance,
                status: player.status,
                lastActive: player.last_active
            }));
        } finally {
            conn.release();
        }
    }

    static async togglePlayerStatus(playerId) {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            // Get current status
            const [player] = await conn.execute(
                'SELECT status FROM users WHERE id = ?',
                [playerId]
            );

            const newStatus = player[0].status === 'active' ? 'blocked' : 'active';

            // Update status
            await conn.execute(
                'UPDATE users SET status = ? WHERE id = ?',
                [newStatus, playerId]
            );

            // If blocking, remove from active games
            if (newStatus === 'blocked') {
                await conn.execute(
                    'UPDATE player_positions SET status = ?, left_at = CURRENT_TIMESTAMP WHERE user_id = ? AND status = ?',
                    ['left', playerId, 'active']
                );
            }

            await conn.commit();
            return newStatus;
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    static async getKYCQueue() {
        const conn = await pool.getConnection();
        try {
            const [submissions] = await conn.execute(
                `SELECT 
                    p.*,
                    u.username
                FROM profile p
                JOIN users u ON p.user_id = u.id
                WHERE p.status = 'pending'
                ORDER BY p.created_at ASC`
            );

            return submissions.map(sub => ({
                id: sub.id,
                userId: sub.user_id,
                username: sub.username,
                firstName: sub.first_name,
                lastName: sub.last_name,
                status: sub.status,
                submissionDate: sub.created_at
            }));
        } finally {
            conn.release();
        }
    }

    static async reviewKYC(submissionId, status, rejectionReason = null) {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            await conn.execute(
                `UPDATE profile 
                SET status = ?,
                    rejection_reason = ?,
                    verified_at = CURRENT_TIMESTAMP
                WHERE id = ?`,
                [status, rejectionReason, submissionId]
            );

            await conn.commit();
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }

    static async getSystemSettings() {
        const conn = await pool.getConnection();
        try {
            const [settings] = await conn.execute('SELECT * FROM system_settings');
            return settings[0] || {};
        } finally {
            conn.release();
        }
    }

    static async updateSystemSettings(settings) {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            await conn.execute(
                `UPDATE system_settings 
                SET 
                    default_min_bet = ?,
                    default_max_bet = ?,
                    default_decks = ?`,
                [settings.defaultMinBet, settings.defaultMaxBet, settings.defaultDecks]
            );

            await conn.commit();
        } catch (error) {
            await conn.rollback();
            throw error;
        } finally {
            conn.release();
        }
    }
}

module.exports = AdminHandler;
