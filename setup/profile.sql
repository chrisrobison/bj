-- KYC information table
CREATE TABLE `profile` (
    id int(15) not null auto_increment PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    date_of_birth DATE NOT NULL,
    nationality VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50) NOT NULL,
    street_address VARCHAR(255) NOT NULL,
    street_address2 VARCHAR(255),
    city VARCHAR(100) NOT NULL,
    state_province VARCHAR(100) NOT NULL,
    postal_code VARCHAR(20) NOT NULL,
    country VARCHAR(100) NOT NULL,
    id_type ENUM('passport', 'nationalId', 'driverLicense') NOT NULL,
    id_number VARCHAR(100) NOT NULL,
    id_expiry DATE NOT NULL,
    id_document_path VARCHAR(255) NOT NULL,
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    verified_at TIMESTAMP,
    verified_by VARCHAR(36),
    rejection_reason TEXT
);

-- Add indexes for common queries
CREATE INDEX idx_profile_status ON profile(status);
CREATE INDEX idx_profile_created ON profile(created_at);
