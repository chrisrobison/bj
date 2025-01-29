// server/routes/auth.js
const express = require('express');
const router = express.Router();
const UserAuth = require('../userAuth');

router.post('/signup', async (req, res) => {
    try {
        const { username, email, password } = req.body;
        
        // Basic validation
        if (!username || !email || !password) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: 'Password too short' });
        }

        const verificationToken = await UserAuth.createUser(username, email, password);
        
        res.json({ 
            message: 'User created successfully',
            verificationToken // In production, this would be sent via email
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await UserAuth.authenticateUser(username, password);
        
        // Create session
        req.session.userId = user.id;
        req.session.username = user.username;
        
        res.json({ message: 'Login successful', user });
    } catch (error) {
        res.status(401).json({ error: error.message });
    }
});

router.post('/logout', (req, res) => {
    req.session.destroy();
    res.json({ message: 'Logout successful' });
});

router.get('/verify/:token', async (req, res) => {
    try {
        const success = await UserAuth.verifyUser(req.params.token);
        if (success) {
            res.json({ message: 'Account verified successfully' });
        } else {
            res.status(400).json({ error: 'Invalid verification token' });
        }
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;
