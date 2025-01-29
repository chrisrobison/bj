// server/userAuth.js
const crypto = require('crypto');
const pool = require('./db');

class UserAuth {
    static hashPassword(password) {
        return crypto.createHash('sha256')
            .update(password)
            .digest('hex');
    }

    static generateVerificationToken() {
        return crypto.randomBytes(32).toString('hex');
    }

    static async createUser(username, email, password) {
        const conn = await pool.getConnection();
        try {
            // Check if username or email already exists
            const [existing] = await conn.execute(
                'SELECT id FROM users WHERE username = ? OR email = ?',
                [username, email]
            );

            if (existing.length > 0) {
                throw new Error('Username or email already exists');
            }

            const passwordHash = this.hashPassword(password);
            const verificationToken = this.generateVerificationToken();

            await conn.execute(
                'INSERT INTO users (username, email, password_hash, verification_token) VALUES (?, ?, ?, ?)',
                [username, email, passwordHash, verificationToken]
            );

            // In a real application, you would send a verification email here
            return verificationToken;
        } finally {
            conn.release();
        }
    }

    static async verifyUser(token) {
        const [result] = await pool.execute(
            'UPDATE users SET is_verified = true, verification_token = NULL WHERE verification_token = ?',
            [token]
        );
        return result.affectedRows > 0;
    }

    static async authenticateUser(username, password) {
        const [users] = await pool.execute(
            'SELECT id, username, is_verified, password_hash FROM users WHERE username = ?',
            [username]
        );

        if (users.length === 0) {
            throw new Error('User not found');
        }

        const user = users[0];
        const passwordHash = this.hashPassword(password);

        if (passwordHash !== user.password_hash) {
            throw new Error('Invalid password');
        }

        if (!user.is_verified) {
            throw new Error('Account not verified');
        }

        // Update last login
        await pool.execute(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
            [user.id]
        );

        return {
            id: user.id,
            username: user.username
        };
    }
}

module.exports = UserAuth;


