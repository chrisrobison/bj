// server/auth.js
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'; // Use environment variable in production
const TOKEN_EXPIRY = '24h';

class Auth {
    static hashPassword(password) {
        return crypto.createHash('sha256')
            .update(password)
            .digest('hex');
    }

    static generateToken(user) {
        return jwt.sign(
            { 
                id: user.id, 
                username: user.username 
            },
            JWT_SECRET,
            { expiresIn: TOKEN_EXPIRY }
        );
    }

    static verifyToken(token) {
        try {
            return jwt.verify(token, JWT_SECRET);
        } catch (error) {
            return null;
        }
    }

    static async createUser(username, email, password) {
        const conn = await pool.getConnection();
        try {
            // Check if username or email exists
            const [existing] = await conn.execute(
                'SELECT id FROM users WHERE username = ? OR email = ?',
                [username, email]
            );

            if (existing.length > 0) {
                throw new Error('Username or email already exists');
            }

            const passwordHash = this.hashPassword(password);

            const [result] = await conn.execute(
                'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
                [username, email, passwordHash]
            );

            const userId = result.insertId;
            const token = this.generateToken({ id: userId, username });

            return { userId, token };
        } finally {
            conn.release();
        }
    }

    static async authenticateUser(username, password) {
        const [users] = await pool.execute(
            'SELECT id, username, password_hash FROM users WHERE username = ?',
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

        // Update last login
        await pool.execute(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
            [user.id]
        );

        const token = this.generateToken(user);

        return {
            id: user.id,
            username: user.username,
            token
        };
    }
}

module.exports = Auth;


