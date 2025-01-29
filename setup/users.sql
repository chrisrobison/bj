-- users.sql
CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash CHAR(64) NOT NULL,  -- SHA256 produces 64 character hash
    balance DECIMAL(15,2) DEFAULT 0.00,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP NULL,
    is_active BOOLEAN DEFAULT true,
    verification_token CHAR(64) NULL,
    is_verified BOOLEAN DEFAULT false
);

-- Add indexes for commonly searched fields
CREATE INDEX idx_username ON users(username);
CREATE INDEX idx_email ON users(email);
