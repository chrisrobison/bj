import { Card, Deck } from './deck.js';

class GameUI {
    constructor() {
        this.gameWorker = null;
        this.lastGamePhase = null;
        this.deck = new Deck(6); // Use 6 decks for blackjack
        this.dealerCards = [];
        this.playerCards = [];
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Setup chip click listeners
        const chipsContainer = document.getElementById('chips');
        if (chipsContainer) {
            const chips = chipsContainer.getElementsByClassName('chip');
            Array.from(chips).forEach(chip => {
                chip.addEventListener('click', (e) => {
                    e.preventDefault();
                    console.log('Chip clicked');
                    const span = chip.querySelector('span');
                    if (span) {
                        const amount = parseInt(span.textContent.replace(/[^0-9]/g, ''));
                        console.log('Betting amount:', amount);
                        this.placeBet(amount);
                    }
                });
            });
        }

        // Setup action button listeners
        ['hit', 'stand', 'double', 'split'].forEach(actionId => {
            const button = document.getElementById(actionId);
            if (button) {
                button.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.performAction(actionId);
                });
            }
        });
    }

    init() {
        const token = localStorage.getItem('jwt_token');
        if (!token) {
            window.location.href = '/login.html';
            return;
        }

        this.gameWorker = new Worker('gameWorker.js');
        this.gameWorker.onmessage = (e) => this.handleWorkerMessage(e.data);

        // Initialize worker
        this.gameWorker.postMessage({ 
            type: 'init', 
            baseUrl: location.hostname,
            token: token
        });

        // Connect after initialization
        setTimeout(() => {
            this.gameWorker.postMessage({ type: 'connect' });
        }, 100);
    }

    handleWorkerMessage(message) {
        console.log('Worker message received:', message);
        
        switch(message.type) {
            case 'connection_status':
                this.handleConnectionStatus(message.status);
                break;
            case 'state_update':
                this.handleStateUpdate(message.data);
                break;
            case 'error':
                this.handleError(message.error);
                break;
            default:
                console.warn('Unknown message type:', message.type);
        }
    }

    handleConnectionStatus(status) {
        console.log('Connection status:', status);
        if (status === 'connected') {
            // Clear any existing player ID when starting fresh
            localStorage.removeItem('playerId');
            console.log('Cleared existing player ID');
            
            setTimeout(() => {
                console.log('Joining table...');
                this.gameWorker.postMessage({ type: 'join_table' });
            }, 100);
        }
    }

    handleStateUpdate(state) {
        console.log('Game state:', state);
        
        // Store the player ID when we get state
        if (state.players && state.players.length > 0) {
            const userStr = localStorage.getItem('user_data');
            if (userStr) {
                const userData = JSON.parse(userStr);
                const ourPlayer = state.players.find(p => p.id === userData.id);
                if (ourPlayer) {
                    console.log('Found our player:', ourPlayer);
                    localStorage.setItem('playerId', ourPlayer.id);
                }
            }
        }
        
        const playerId = localStorage.getItem('playerId');
        console.log('Current game phase:', state.gamePhase);
        console.log('Our player ID:', playerId);
        console.log('All players:', state.players);
        
        this.updateUI(state);
        this.updateControls(state);
        this.updateGamePhaseMessage(state);
    }

    handleError(error) {
        console.error('Game error:', error);
        this.showMessage(error);
    }

    updateUI(state) {
        this.updateDealerCards(state.dealer);
        this.updatePlayerCards(state.players);
    }

    updateDealerCards(dealer) {
        const dealerCards = document.querySelector('#dealer .cards');
        if (!dealerCards) return;
        
        dealerCards.innerHTML = '';
        dealer.cards.forEach(async (cardData, i) => {
            // Create new card instance
            const card = new Card(cardData.value, cardData.suit);
            dealerCards.appendChild(card.element);

            // Calculate position
            const centerX = dealerCards.offsetWidth / 2;
            const xOffset = (i - (dealer.cards.length - 1) / 2) * 160;
            const x = centerX + xOffset;
            
            // Deal with animation
            await card.dealTo(x, 0, 0, i * 200, cardData.hidden ? 1 : 0);
        });
    }

    updatePlayerCards(players) {
        const userStr = localStorage.getItem('user_data');
        const userData = userStr ? JSON.parse(userStr) : null;
        const ourPlayerId = userData ? userData.id : null;
        
        players.forEach(async (player, index) => {
            const playerEl = document.getElementById(`player${index + 1}`);
            if (!playerEl) return;

            // Handle active player highlighting
            if (player.id === ourPlayerId) {
                playerEl.classList.add('active');
            } else {
                playerEl.classList.remove('active');
            }

            const cardsEl = playerEl.querySelector('.cards');
            if (!cardsEl || !player.hands) return;

            // Get current hand
            const currentHand = Array.isArray(player.hands) ? 
                player.hands[player.currentHand || 0] : 
                (Array.isArray(player.hands[player.currentHand]) ? 
                    player.hands[player.currentHand] : []);

            // Remember existing card count
            const existingCards = cardsEl.querySelectorAll('.card').length;
            cardsEl.innerHTML = '';

            // Deal cards
            currentHand.forEach(async (cardData, i) => {
                const card = new Card(cardData.value, cardData.suit);
                cardsEl.appendChild(card.element);

                const centerX = cardsEl.offsetWidth / 2;
                const xOffset = (i - (currentHand.length - 1) / 2) * 160;
                const x = centerX + xOffset;
                const y = 0;

                // Only animate new cards
                if (i >= existingCards) {
                    await card.dealTo(x, y, 0, i * 200);
                } else {
                    card.element.style.transform = `translate(${x}px, ${y}px)`;
                }
            });

            // Update bet amount
            const betEl = playerEl.querySelector('.bet span');
            if (betEl) {
                betEl.textContent = player.bet || '0';
            }
        });
    }

    // Add the new helper method for calculating positions
    calculateCardPosition(index, totalCards, containerWidth) {
        const cardWidth = 140; // Card width in pixels
        const spacing = 20; // Space between cards
        const totalWidth = (totalCards * cardWidth) + ((totalCards - 1) * spacing);
        const startX = (containerWidth - totalWidth) / 2;
        return startX + (index * (cardWidth + spacing));
    }

    async animateCardToHand(card, position) {
        const {x, y} = position;
        await card.dealTo(x, y);
    }

    // Update the game state update handler to use animations
    handleStateUpdate(state) {
        console.log('Game state:', state);
        
        if (this.isNewHand(state)) {
            // Clear existing cards with animation
            this.clearTableWithAnimation().then(() => {
                this.updateDealerCards(state.dealer);
                this.updatePlayerCards(state.players);
            });
        } else {
            // Update without clearing
            this.updateDealerCards(state.dealer);
            this.updatePlayerCards(state.players);
        }
        
        this.updateControls(state);
        this.updateGamePhaseMessage(state);
    }

    isNewHand(state) {
        // Determine if this is a new hand starting
        return state.gamePhase === 'dealing' && 
               (!this.lastState || this.lastState.gamePhase === 'betting');
    }

    async clearTableWithAnimation() {
        const cards = document.querySelectorAll('.card');
        const animations = Array.from(cards).map(card => {
            return new Promise(resolve => {
                card.style.transition = 'all 0.5s ease';
                card.style.transform = 'translate(-1000px, -200px) rotate(-45deg)';
                card.style.opacity = '0';
                setTimeout(() => {
                    card.remove();
                    resolve();
                }, 500);
            });
        });
        await Promise.all(animations);
    }

    updateControls(state) {
        console.log('Updating controls for game phase:', state.gamePhase);
        console.log('Full state:', state);
        
        const controls = {
            hit: document.getElementById('hit'),
            stand: document.getElementById('stand'),
            double: document.getElementById('double'),
            split: document.getElementById('split'),
            chips: document.getElementById('chips')
        };

        // Get current player info
        const userStr = localStorage.getItem('user_data');
        const userData = userStr ? JSON.parse(userStr) : null;
        const playerId = userData ? userData.id : null;
        
        console.log('Current player ID:', playerId);

        // Hide chips by default during gameplay
        if (controls.chips) {
            controls.chips.style.display = state.gamePhase === 'betting' ? 'flex' : 'none';
        }

        // Disable all action buttons by default
        Object.values(controls).forEach(control => {
            if (control && control !== controls.chips) {
                control.disabled = true;
            }
        });

        // Find the current player's data
        const currentPlayer = state.players.find(p => p.id === playerId);
        console.log('Current player data:', currentPlayer);

        if (!currentPlayer) {
            console.log('No current player found');
            return;
        }

        switch(state.gamePhase) {
            case 'betting':
                console.log('Betting phase - showing chips');
                if (controls.chips) {
                    controls.chips.style.display = 'flex';
                    // Only enable chips if player hasn't bet
                    controls.chips.style.pointerEvents = (!currentPlayer.bet || currentPlayer.bet === 0) ? 'auto' : 'none';
                }
                break;

            case 'playing':
                console.log('Playing phase - checking if current turn');
                console.log('State current player:', state.currentPlayer);
                console.log('Player ID:', playerId);
                console.log('Player status:', currentPlayer.status);

                // Enable controls only if it's this player's turn and they're still playing
                if (state.currentPlayer === playerId && currentPlayer.status === 'playing') {
                    console.log('Enabling playing controls');
                    
                    // Enable basic actions
                    controls.hit.disabled = false;
                    controls.stand.disabled = false;

                    // Get current hand
                    const currentHand = currentPlayer.hands[currentPlayer.currentHand];
                    console.log('Current hand:', currentHand);

                    if (currentHand && currentHand.length === 2) {
                        // Enable double down on initial two cards
                        controls.double.disabled = false;

                        // Enable split if cards have same value
                        if (currentHand[0].value === currentHand[1].value) {
                            controls.split.disabled = false;
                        }
                    }
                } else {
                    console.log('Not current player\'s turn or not playing');
                }
                break;

            case 'dealer_turn':
                // Disable all controls during dealer's turn
                Object.values(controls).forEach(control => {
                    if (control) control.disabled = true;
                });
                break;

            default:
                console.log('Unknown game phase:', state.gamePhase);
                break;
        }
    }

    // Helper method to check if two cards are splittable
    areCardsSplittable(card1, card2) {
        // Handle face cards (J, Q, K all have value 10)
        const value1 = card1.value > 10 ? 10 : card1.value;
        const value2 = card2.value > 10 ? 10 : card2.value;
        return value1 === value2;
    }



    updateGamePhaseMessage(state) {
        console.log('Updating game phase message. Current phase:', state.gamePhase);
        console.log('Last phase:', this.lastGamePhase);

        const userStr = localStorage.getItem('user_data');
        const userData = userStr ? JSON.parse(userStr) : null;
        const playerId = userData ? userData.id : null;
        
        const player = state.players.find(p => p.id === playerId);
        console.log('Found player:', player, 'with ID:', playerId);

        // Show betting message when phase changes to betting OR when last phase is null
        if (state.gamePhase === 'betting' && (this.lastGamePhase !== 'betting' || this.lastGamePhase === null)) {
            if (player) {
                console.log('Player bet amount:', player.bet);
                if (!player.bet || player.bet === 0) {
                    console.log('Showing place bet message');
                    this.showMessage('Place your bet!');
                }
            }
        } else if (state.gamePhase === 'dealer_turn' && this.lastGamePhase !== 'dealer_turn') {
            this.showMessage('Dealer\'s turn...');
        } else if (state.gamePhase === 'completing' && this.lastGamePhase !== 'completing') {
            if (player) {
                const result = this.calculateResult(player, state.dealer);
                this.showMessage(`Game Over! ${result}`);
            }
        }

        this.lastGamePhase = state.gamePhase;
    }

    calculateResult(player, dealer) {
        if (player.status === 'busted') return 'Busted! Better luck next time!';

        const playerTotal = this.calculateHandTotal(player.hands[player.currentHand]);
        const dealerTotal = this.calculateHandTotal(dealer.cards);

        if (dealerTotal > 21) return 'Dealer busted! You win!';
        if (playerTotal > dealerTotal) return 'You win!';
        if (playerTotal < dealerTotal) return 'Dealer wins!';
        return 'Push!';
    }

    calculateHandTotal(cards) {
        let total = 0;
        let aces = 0;

        for (const card of cards) {
            if (card.value === 1) {
                aces++;
            } else {
                total += Math.min(10, card.value);
            }
        }

        // Add aces
        for (let i = 0; i < aces; i++) {
            total += (total + 11 <= 21) ? 11 : 1;
        }

        return total;
    }

    showMessage(message) {
        Toastify({
            text: message,
            duration: 3000,
            gravity: "top",
            position: 'center'
        }).showToast();
    }

    placeBet(amount) {
        console.log('Attempting to place bet:', amount);
        
        // Validate the bet amount
        if (!amount || isNaN(amount) || amount <= 0) {
            console.error('Invalid bet amount:', amount);
            return;
        }

        if (this.gameWorker) {
            const message = {
                type: 'place_bet',
                amount: amount
            };
            console.log('Sending bet message to worker:', message);
            this.gameWorker.postMessage(message);
        } else {
            console.error('Game worker not initialized when trying to place bet');
        }
    }

    performAction(action) {
        console.log('Performing action:', action);
        if (this.gameWorker) {
            this.gameWorker.postMessage({
                type: 'action',
                action: action
            });
        }
    }
}

// Initialize the game when the page loads
document.addEventListener('DOMContentLoaded', () => {
    const game = new GameUI();
    game.init();
});

export default GameUI;

