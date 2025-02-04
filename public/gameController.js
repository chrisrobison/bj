// client/gameController.js
class BlackjackController {
  constructor() {
    this.worker = new Worker('gameWorker.js');
    this.gameState = null;
    this.setupWorkerHandlers();
  }

  setupWorkerHandlers() {
    this.worker.onmessage = (event) => {
      const message = event.data;

      switch (message.type) {
        case 'connection_status':
          this.handleConnectionStatus(message.status);
          break;
        case 'state_update':
          this.handleStateUpdate(message.data);
          break;
        case 'error':
          this.handleError(message.error);
          break;
      }
    };
  }

  connect() {
    this.worker.postMessage({ type: 'connect' });
  }

  joinTable(tableId = null) {
    this.worker.postMessage({
      type: 'join_table',
      tableId,
    });
  }

  placeBet(amount) {
    this.worker.postMessage({
      type: 'place_bet',
      amount,
    });
  }

  performAction(action) {
    this.worker.postMessage({
      type: 'action',
      action, // 'hit', 'stand', 'double', 'split'
    });
  }

  handleConnectionStatus(status) {
    console.log('Connection status:', status);
    if (status === 'connected') {
      // Auto-join a table or show table selection UI
      this.joinTable();
    }
  }

  handleStateUpdate(state) {
    this.gameState = state;
    // Trigger UI update
    this.updateUI(state);
  }

  handleError(error) {
    console.error('Game error:', error);
    // Show error in UI
  }

  updateUI(state) {
    // This will be implemented by the UI layer
    console.log('Game state updated:', state);

    // Dispatch custom event for UI components
    const event = new CustomEvent('gameStateUpdate', {
      detail: state,
    });
    document.dispatchEvent(event);
  }
}

// To use in the app:
const game = new BlackjackController();
game.connect();
