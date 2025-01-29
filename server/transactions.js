// server/transactions.js
class TransactionManager {
    constructor() {
        this.transactions = new Map();
        this.balances = new Map();
    }

    async createTransaction(playerId, amount, type) {
        const txId = Math.random().toString(36).substr(2, 9);
        
        const transaction = {
            id: txId,
            playerId,
            amount,
            type, // 'bet', 'win', 'deposit', 'withdraw'
            status: 'pending',
            timestamp: Date.now()
        };

        this.transactions.set(txId, transaction);
        return transaction;
    }

    async processBet(playerId, amount) {
        const balance = this.getBalance(playerId);
        
        if (balance < amount) {
            throw new Error('Insufficient funds');
        }

        const tx = await this.createTransaction(playerId, amount, 'bet');
        
        try {
            // Here you would integrate with your crypto payment system
            await this.updateBalance(playerId, -amount);
            
            tx.status = 'completed';
            return tx;
        } catch (error) {
            tx.status = 'failed';
            tx.error = error.message;
            throw error;
        }
    }

    async processWin(playerId, amount) {
        const tx = await this.createTransaction(playerId, amount, 'win');
        
        try {
            await this.updateBalance(playerId, amount);
            tx.status = 'completed';
            return tx;
        } catch (error) {
            tx.status = 'failed';
            tx.error = error.message;
            throw error;
        }
    }

    getBalance(playerId) {
        return this.balances.get(playerId) || 1000; // Start with 1000 for testing
    }

    async updateBalance(playerId, delta) {
        const currentBalance = this.getBalance(playerId);
        const newBalance = currentBalance + delta;
        
        if (newBalance < 0) {
            throw new Error('Insufficient funds');
        }
        
        this.balances.set(playerId, newBalance);
        return newBalance;
    }
}

module.exports = { TransactionManager };
