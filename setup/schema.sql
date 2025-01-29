-- Database schema for game state management

-- Tables table to track active and historical tables
CREATE TABLE tables (
    id VARCHAR(36) PRIMARY KEY,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    status ENUM('active', 'closed') DEFAULT 'active',
    config JSON NOT NULL, -- Store table configuration
    current_shoe JSON, -- Store current shoe state
    burn_card JSON -- Store burn card
);

-- Games table to track individual games at each table
CREATE TABLE games (
    id VARCHAR(36) PRIMARY KEY,
    table_id VARCHAR(36) NOT NULL,
    started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    game_phase ENUM('betting', 'dealing', 'player_turns', 'dealer_turn', 'completing') NOT NULL,
    dealer_cards JSON, -- Store dealer's cards
    current_player_position INT NULL, -- Track whose turn it is
    status ENUM('active', 'completed', 'cancelled') DEFAULT 'active',
    FOREIGN KEY (table_id) REFERENCES tables(id)
);

-- Player positions at tables
CREATE TABLE player_positions (
    id VARCHAR(36) PRIMARY KEY,
    table_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    position INT NOT NULL,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    left_at TIMESTAMP NULL,
    status ENUM('active', 'left') DEFAULT 'active',
    FOREIGN KEY (table_id) REFERENCES tables(id),
    UNIQUE KEY table_position (table_id, position, status)
);

-- Player hands in each game
CREATE TABLE player_hands (
    id VARCHAR(36) PRIMARY KEY,
    game_id VARCHAR(36) NOT NULL,
    player_position_id VARCHAR(36) NOT NULL,
    cards JSON NOT NULL, -- Store player's cards
    bet_amount DECIMAL(10,2) NOT NULL,
    hand_number INT DEFAULT 0, -- For split hands
    status ENUM('betting', 'playing', 'standing', 'busted', 'blackjack', 'surrendered') NOT NULL,
    is_current_hand BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (game_id) REFERENCES games(id),
    FOREIGN KEY (player_position_id) REFERENCES player_positions(id)
);

-- Game results for tracking outcomes
CREATE TABLE game_results (
    id VARCHAR(36) PRIMARY KEY,
    game_id VARCHAR(36) NOT NULL,
    player_hand_id VARCHAR(36) NOT NULL,
    outcome ENUM('win', 'lose', 'push', 'blackjack') NOT NULL,
    payout_amount DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (game_id) REFERENCES games(id),
    FOREIGN KEY (player_hand_id) REFERENCES player_hands(id)
);

-- Indexes for performance
CREATE INDEX idx_tables_status ON tables(status);
CREATE INDEX idx_games_table_status ON games(table_id, status);
CREATE INDEX idx_player_positions_table ON player_positions(table_id, status);
CREATE INDEX idx_player_hands_game ON player_hands(game_id);
CREATE INDEX idx_game_results_game ON game_results(game_id);
