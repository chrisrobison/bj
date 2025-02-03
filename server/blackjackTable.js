/* eslint-disable prefer-destructuring */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-plusplus */
// server/table.js
class BlackjackTable {
  constructor(config) {
    this.id = Math.random().toString(36).substr(2, 9);
    this.config = {
      decks: config.decks || 6,
      continuousShuffle: config.continuousShuffle || true,
      maxPlayers: config.maxPlayers || 5,
      minBet: config.minBet || 1,
      maxBet: config.maxBet || 500,
      doubleDown: config.doubleDown || 'any',
      doubleAfterSplit: config.doubleAfterSplit || true,
      dealerHitSoft17: config.dealerHitSoft17 || true,
    };

    this.shoe = [];
    this.players = new Map();
    this.dealer = {
      cards: [],
      total: 0,
    };
    this.gamePhase = 'betting'; // betting, dealing, playing, completing
    this.currentPlayer = null;
    this.burnCard = null;

    this.initShoe();
  }

  // Helper method to initialize shoe with logging
  initShoe() {
    console.log('Initializing shoe...');
    this.shoe = [];
    const suits = ['♥', '♦', '♠', '♣'];
    const values = Array.from({
      length: 13,
    }, (_, i) => i + 1);

    for (let d = 0; d < this.config.decks; d++) {
      for (const suit of suits) {
        for (const value of values) {
          this.shoe.push({
            value,
            suit,
          });
        }
      }
    }

    console.log(`Created shoe with ${this.shoe.length} cards`);
    this.shuffle();
    console.log('Shoe shuffled');
    this.burnCard = this.shoe.pop();
    console.log('Burn card drawn:', this.burnCard);
  }

  shuffle() {
    for (let i = this.shoe.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.shoe[i], this.shoe[j]] = [this.shoe[j], this.shoe[i]];
    }
  }

  addPlayer(playerId) {
    if (this.players.size >= this.config.maxPlayers) {
      return false;
    }

    this.players.set(playerId, {
      id: playerId,
      hands: [
        [],
      ],
      currentHand: 0,
      bet: 0,
      status: 'betting',
    });

    return true;
  }

  removePlayer(playerId) {
    return this.players.delete(playerId);
  }

  getState() {
    console.log('Getting table state, dealer cards:', this.dealer.cards);
    return {
      id: this.id,
      config: this.config,
      gamePhase: this.gamePhase,
      currentPlayer: this.currentPlayer,
      dealer: {
        cards: [...this.dealer.cards], // Make a copy to avoid reference issues
        total: this.calculateHand(this.dealer.cards),
      },
      players: Array.from(this.players.entries()).map(([id, player]) => ({
        id,
        hands: [...player.hands], // Make a copy
        currentHand: player.currentHand,
        bet: player.bet,
        status: player.status,
      })),
    };
  }

  getPlayerView(playerId, state) {
    const view = {
      ...state,
    };
    // Hide dealer's hole card during play
    if (this.gamePhase === 'playing') {
      view.dealer = {
        ...view.dealer,
        cards: [view.dealer.cards[0], {
          hidden: true,
        }],
      };
    }
    return view;
  }

  async startRound() {
    console.log('Starting new round...');

    // Update game phase in both memory and database
    this.gamePhase = 'dealing';
    if (global.gameStateManager) {
      await global.gameStateManager.updateGamePhase(this.id, 'dealing');
    }

    // Check if we need to shuffle
    if (this.shoe.length < 52) {
      console.log('Shoe running low, reshuffling...');
      this.initShoe();
    }

    // Deal initial cards
    console.log('Dealing initial cards...');
    for (let i = 0; i < 2; i++) {
      // Deal to players first

      for (const [playerId, player] of this.players.entries()) {
        if (!player.hands[0]) {
          player.hands[0] = [];
        }
        const card = this.drawCard();
        console.log(`Dealing card to player ${playerId}:`, card);
        player.hands[0].push(card);
        player.status = 'playing';
      }

      // Then to dealer
      const dealerCard = this.drawCard();
      console.log('Dealing card to dealer:', dealerCard);
      this.dealer.cards.push(dealerCard);
    }

    // Set game phase to playing
    this.gamePhase = 'playing';
    if (global.gameStateManager) {
      await global.gameStateManager.updateGamePhase(this.id, 'playing');
    }

    // Set first player as current
    const playerIds = Array.from(this.players.keys());
    if (playerIds.length > 0) {
      this.currentPlayer = playerIds[0];
    }

    // Check for dealer blackjack
    const dealerUpCard = this.dealer.cards[0];
    if (dealerUpCard.value === 1 || dealerUpCard.value >= 10) {
      const dealerTotal = this.calculateHand(this.dealer.cards);
      if (dealerTotal === 21) {
        console.log('Dealer has blackjack!');
        return this.completeRound();
      }
    }

    // Get updated state
    const state = this.getState();
    console.log('New round state:', state);
    return state;
  }

  // Helper method to draw a card with logging
  drawCard() {
    if (this.shoe.length === 0) {
      console.log('Shoe empty, initializing new shoe');
      this.initShoe();
    }
    const card = this.shoe.pop();
    console.log('Drew card:', card);
    return card;
  }

  calculateHand(cards) {
    let total = 0;
    let aces = 0;

    if (this) console.log('Calculating hand:', cards);
    for (const card of cards) {
      if (card.value === 1) {
        aces++;
      } else {
        total += Math.min(10, card.value);
      }
    }

    // Add aces
    for (let i = 0; i < aces; i++) {
      if (total + 11 <= 21) {
        total += 11;
      } else {
        total += 1;
      }
    }

    return total;
  }

  completeRound() {
    this.gamePhase = 'completing';
    // Reveal dealer's cards
    while (this.calculateHand(this.dealer.cards) < 17) {
      this.dealer.cards.push(this.drawCard());
    }

    const dealerTotal = this.calculateHand(this.dealer.cards);

    // Compare hands and settle bets
    for (const player of this.players.values()) {
      for (const hand of player.hands) {
        const playerTotal = this.calculateHand(hand);

        if (dealerTotal > 21 || playerTotal > dealerTotal) {
          console.log(`Player ${player.id} wins!`);
        }
      }
    }

    // Reset for next round
    this.gamePhase = 'betting';
    this.currentPlayer = null;

    // Reset player hands and status
    for (const player of this.players.values()) {
      player.hands = [
        [],
      ];
      player.currentHand = 0;
      player.bet = 0;
      player.status = 'betting';
    }
  }
}
module.exports = BlackjackTable;
