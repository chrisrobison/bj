// server/middleware/adminAuth.js
const Auth = require('../auth');

function adminAuthMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    const user = Auth.verifyToken(token);
    if (!user) {
        return res.status(403).json({ error: 'Invalid or expired token' });
    }

    // Check if user is admin
    if (!user.isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    req.user = user;
    next();
}

module.exports = { adminAuthMiddleware };
