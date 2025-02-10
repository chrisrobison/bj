// Card class to represent individual cards
class Card {
    constructor(value, suit) {
        this.value = value;
        this.suit = suit;
        this.faceDown = false;
        this.element = this.createCardElement();
    }

    // Create DOM element for the card
    createCardElement() {
        const card = document.createElement('div');
        card.className = `card card-${this.value}${this.suitChar}`;
        card.style.width = '140px';
        card.style.height = '190px';
        card.style.position = 'absolute';
        card.style.left = '0';
        card.style.top = '0';
        
        // Create inner elements for front/back
        const cardInner = document.createElement('div');
        cardInner.className = 'card-inner';
        
        const cardFront = document.createElement('div');
        cardFront.className = 'card-front';
        
        const cardBack = document.createElement('div');
        cardBack.className = 'card-back';
        
        cardInner.appendChild(cardFront);
        cardInner.appendChild(cardBack);
        card.appendChild(cardInner);

        console.log(`Created card element for ${this.toString()} with class ${card.className}`);
        return card;
    }

    // Deal card to a specific position
    async dealTo(x, y, rotation = 0, delay = 10, holecard = 0) {
        console.log(`Dealing card to x:${x} y:${y} rotation:${rotation} delay:${delay}`);
        
        this.element.style.opacity = '1'; // Ensure card is visible
        this.element.style.top = '0';
        this.element.style.left = '0';
        this.element.style.transform = 'translate(0, 0) rotate(-1440deg)';
        this.element.style.transition = 'all 0.6s cubic-bezier(0.25, 0.8, 0.25, 1)';
        this.element.classList.add('flip');
        setTimeout(() => { 
            this.element.style.transform = `translate(${x}px, ${y}px)`;
        }, 100);
        
        return new Promise(resolve => {
            setTimeout(() => {
                if (!holecard) this.element.classList.remove('flip');
                console.log(`Completed dealing ${this.toString()}`);
                resolve();
            }, 800); // Match the transition duration
        });
    }

    // Flip card
    flip() {
        this.faceDown = !this.faceDown;
        this.element.classList.toggle('flip');
        return new Promise(resolve => {
            setTimeout(resolve, 600); // Match the CSS transition duration
        });
    }

    // Get the actual value for blackjack scoring
    get blackjackValue() {
        if (this.value === 1) return 11;  // Ace defaults to 11
        if (this.value > 10) return 10;   // Face cards are worth 10
        return this.value;
    }

    // Convert symbol for CSS class name
    get suitChar() {
        switch(this.suit) {
            case '♠': return 'S';
            case '♥': return 'H';
            case '♣': return 'C';
            case '♦': return 'D';
            default: return this.suit;
        }
    }

    // Convert card to string representation
    toString() {
        return `${this.value}${this.suit}`;
    }
}

// Deck class to manage a collection of cards
class Deck {
    constructor(numDecks = 1) {
        this.numDecks = numDecks;
        this.cards = [];
        this.reset();
    }

    // Reset deck to original state
    reset() {
        this.cards = [];
        const suits = ['♠', '♥', '♣', '♦'];
        const values = Array.from({length: 13}, (_, i) => i + 1);

        // Create specified number of decks
        for (let d = 0; d < this.numDecks; d++) {
            for (const suit of suits) {
                for (const value of values) {
                    this.cards.push(new Card(value, suit));
                }
            }
        }
        return this;
    }

    // Shuffle the deck using Fisher-Yates algorithm
    shuffle() {
        for (let i = this.cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this.cards[i], this.cards[j]] = [this.cards[j], this.cards[i]];
        }
        return this;
    }

    // Draw a card from the deck
    draw() {
        if (this.cards.length === 0) {
            throw new Error('No cards left in deck');
        }
        return this.cards.pop();
    }

    // Draw multiple cards at once
    drawMultiple(count) {
        const cards = [];
        for (let i = 0; i < count; i++) {
            cards.push(this.draw());
        }
        return cards;
    }

    // Get number of cards remaining
    get remaining() {
        return this.cards.length;
    }

    // Check if deck needs to be reshuffled (less than 25% remaining)
    get needsShuffle() {
        return this.remaining < (52 * this.numDecks * 0.25);
    }
}

// Export both classes
export { Card, Deck };
