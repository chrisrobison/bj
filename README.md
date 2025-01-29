# 🎰 Real-Time Multiplayer Blackjack

A modern, secure, real-time multiplayer Blackjack game implementation using WebSocket technology and Node.js. This project features a responsive web interface, secure authentication, and real-time game state management.

## ✨ Features

- 🎮 Real-time multiplayer gameplay using WebSocket
- 🔐 Secure user authentication with JWT
- 📱 Responsive web interface with modern design
- 🎲 Multiple table support with configurable rules
- 💰 Transaction management system
- 🔄 Continuous game state synchronization
- 🔌 Automatic reconnection handling with exponential backoff
- 🔒 SSL/TLS encryption for secure communication

## 🛠️ Technology Stack

- **Frontend**:
  - 🌐 HTML5, CSS3, and vanilla JavaScript
  - 📡 WebSocket for real-time communication
  - 👷 Web Workers for background processing
  - 📱 Responsive design for mobile compatibility

- **Backend**:
  - ⚡ Node.js
  - 🚀 Express.js for REST API
  - 📡 WebSocket (ws) for real-time communication
  - 🗄️ MySQL database with connection pooling
  - 🔑 JWT for authentication

## 🏗️ Architecture

The application follows a client-server architecture with several key components:

- **Client-Side**:
  - 🎨 Game UI (`game.html`)
  - 🎮 Game Controller (`gameController.js`)
  - 🔄 WebSocket Worker (`gameWorker.js`)
  - 🔐 Authentication handling (`login.html`, `signup.html`)

- **Server-Side**:
  - 🖥️ Main server (`app.js`)
  - 🔑 Authentication service (`auth.js`)
  - 🎲 Game state management (`gameStateManager.js`)
  - 🎯 Table management (`table.js`)
  - 💳 Transaction handling (`transactions.js`)

## 🚀 Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/blackjack-multiplayer.git
   cd blackjack-multiplayer
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your configuration:
   ```
   PORT=4444
   DB_USER=your_db_user
   DB_PASSWORD=your_db_password
   DB_NAME=blackjack
   JWT_SECRET=your_jwt_secret
   ```

4. Set up SSL certificates (required for secure WebSocket):
   - Place your SSL certificates in the appropriate directory
   - Update the paths in `app.js`

5. Start the server:
   ```bash
   npm start
   ```

## 📋 Game Rules

- ♠️ Standard Blackjack rules apply
- 🎴 Configurable number of decks (default: 6)
- 👥 Dealer must hit on soft 17
- 💫 Double down allowed on any two cards
- ✌️ Split allowed (including split aces)
- 💰 Minimum bet: $1, Maximum bet: $500
- 👥 Maximum 5 players per table

## 🔒 Security Features

- 🔐 SSL/TLS encryption for all communications
- 🎫 JWT-based authentication
- 🔑 Password hashing using SHA-256
- 🔌 Database connection pooling
- ✅ Input validation and sanitization
- 🔐 Secure session management

## 💻 Development

To run the project in development mode:

```bash
npm run dev
```

This will start the server with nodemon for automatic reloading during development.

## 🧪 Testing

A test client is included (`test.html`) for debugging and testing the WebSocket functionality. To use it:

1. Start the server
2. Open `test.html` in your browser
3. Use the provided interface to test different game actions

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📜 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 👏 Acknowledgments

- 🎰 Inspired by classic casino Blackjack games
- 🌟 Built with modern web technologies
- 🚀 Designed for scalability and performance
