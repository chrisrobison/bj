// server/tableManager.js
class TableManager {
    constructor() {
        this.tables = new Map();
    }

    createTable(config) {
        const table = new BlackjackTable(config);
        this.tables.set(table.id, table);
        return table;
    }

    getTable(tableId) {
        return this.tables.get(tableId);
    }

    findAvailableTable() {
        return Array.from(this.tables.values())
            .find(table => table.players.size < table.config.maxPlayers);
    }

    removePlayerFromTable(playerId, tableId) {
        const table = this.tables.get(tableId);
        if (table) {
            table.removePlayer(playerId);
            if (table.players.size === 0) {
                this.tables.delete(tableId);
            }
        }
    }
}

module.exports = { BlackjackTable, TableManager };
