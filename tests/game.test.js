// tests/game.test.js

// Mock Web Worker
class MockWorker {
    constructor(stringUrl) {
        this.url = stringUrl;
        this.onmessage = null;
        this.postMessage = jest.fn((data) => {
            // Simulate worker response
            if (this.onmessage) {
                if (data.type === 'connect') {
                    this.onmessage({
                        data: { type: 'connection_status', status: 'connected' }
                    });
                }
            }
        });
    }
}

// Mock localStorage
const localStorageMock = {
    getItem: jest.fn(),
    setItem: jest.fn(),
    clear: jest.fn(),
    removeItem: jest.fn()
};
global.localStorage = localStorageMock;

// Mock WebSocket
global.WebSocket = class {
    constructor() {
        this.readyState = WebSocket.OPEN;
        setTimeout(() => this.onopen && this.onopen(), 0);
    }
    send() {}
    close() {}
    static OPEN = 1;
};

// Mock Worker
global.Worker = MockWorker;

// Import modules - using dynamic import since we're in Node environment
const loadModules = async () => {
    const fs = require('fs');
    const path = require('path');
    
    // Load the actual source files content
    const controllerContent = fs.readFileSync(path.resolve(__dirname, '../public/gameController.js'), 'utf8');
    const uiContent = fs.readFileSync(path.resolve(__dirname, '../public/gameUI.js'), 'utf8');
    
    // Evaluate in proper context
    const GameController = eval('(function() { ' + controllerContent + ' return BlackjackController; })()');
    const GameUI = eval('(function() { ' + uiContent + ' return GameUI; })()');
    
    return { GameController, GameUI };
};

describe('GameController', () => {
    let GameController;
    let controller;

    beforeAll(async () => {
        const modules = await loadModules();
        GameController = modules.GameController;
    });

    beforeEach(() => {
        document.body.innerHTML = `
            <div id="dealer" class="hand">
                <div class="cards"></div>
            </div>
            <div id="player1" class="hand player">
                <div class="cards"></div>
                <div class="bet"><span>0</span></div>
            </div>
            <button id="hit">Hit</button>
            <button id="stand">Stand</button>
            <button id="double">Double</button>
            <button id="split">Split</button>
            <div id="chips"></div>
        `;
        controller = new GameController();
    });

    test('initializes with empty game state', () => {
        expect(controller.gameState).toBeNull();
    });

    test('connects to game server', () => {
        controller.connect();
        expect(controller.worker.postMessage).toHaveBeenCalledWith({ type: 'connect' });
    });

    test('handles state updates', () => {
        const testState = {
            dealer: { cards: [{ value: 10, suit: '♠' }] },
            players: [{ id: 1, hands: [[{ value: 8, suit: '♥' }]] }]
        };
        
        controller.handleStateUpdate(testState);
        expect(controller.gameState).toEqual(testState);
    });
});

describe('GameUI', () => {
    let GameUI;
    let gameUI;

    beforeAll(async () => {
        const modules = await loadModules();
        GameUI = modules.GameUI;
    });

    beforeEach(() => {
        document.body.innerHTML = `
            <div id="dealer" class="hand">
                <div class="cards"></div>
            </div>
            <div id="player1" class="hand player">
                <div class="cards"></div>
                <div class="bet"><span>0</span></div>
            </div>
            <button id="hit">Hit</button>
            <button id="stand">Stand</button>
            <button id="double">Double</button>
            <button id="split">Split</button>
            <div id="chips"></div>
        `;
        
        localStorage.setItem('jwt_token', 'test-token');
        localStorage.setItem('user_data', JSON.stringify({ id: 1, username: 'test' }));
        
        gameUI = new GameUI();
    });

    test('initializes UI elements', () => {
        expect(document.getElementById('dealer')).toBeTruthy();
        expect(document.getElementById('player1')).toBeTruthy();
        expect(document.getElementById('hit')).toBeTruthy();
    });

    test('updates dealer cards', () => {
        const dealerState = {
            cards: [
                { value: 10, suit: '♠' },
                { value: 7, suit: '♥' }
            ]
        };
        
        gameUI.updateDealerCards(dealerState);
        const dealerCards = document.querySelector('#dealer .cards');
        expect(dealerCards.children.length).toBe(3); // 2 cards + hole card
    });

    test('calculates hand totals correctly', () => {
        const testCases = [
            {
                cards: [{ value: 1, suit: '♥' }, { value: 10, suit: '♠' }],
                expected: 21,
                description: 'Blackjack'
            },
            {
                cards: [{ value: 10, suit: '♥' }, { value: 10, suit: '♠' }, { value: 10, suit: '♦' }],
                expected: 30,
                description: 'Bust'
            },
            {
                cards: [{ value: 1, suit: '♥' }, { value: 1, suit: '♠' }],
                expected: 12,
                description: 'Two aces'
            }
        ];

        testCases.forEach(({ cards, expected, description }) => {
            expect(gameUI.calculateHandTotal(cards)).toBe(expected);
        });
    });

    test('handles betting phase correctly', () => {
        const state = {
            gamePhase: 'betting',
            players: [{
                id: 1,
                bet: 0,
                hands: [[]]
            }]
        };

        gameUI.updateControls(state);
        expect(document.getElementById('chips').style.display).toBe('flex');
        expect(document.getElementById('hit').disabled).toBe(true);
    });

    test('handles playing phase correctly', () => {
        const state = {
            gamePhase: 'playing',
            currentPlayer: 1,
            players: [{
                id: 1,
                status: 'playing',
                hands: [[
                    { value: 8, suit: '♥' },
                    { value: 9, suit: '♣' }
                ]],
                currentHand: 0
            }]
        };

        gameUI.updateControls(state);
        expect(document.getElementById('hit').disabled).toBe(false);
        expect(document.getElementById('stand').disabled).toBe(false);
    });
});

describe('Game Logic', () => {
    let GameUI;
    let gameUI;

    beforeAll(async () => {
        const modules = await loadModules();
        GameUI = modules.GameUI;
    });

    beforeEach(() => {
        gameUI = new GameUI();
    });

    test('splitting pairs', () => {
        const cards = [
            { value: 8, suit: '♥' },
            { value: 8, suit: '♠' }
        ];
        expect(gameUI.areCardsSplittable(cards[0], cards[1])).toBe(true);
    });

    test('splitting face cards', () => {
        const cards = [
            { value: 10, suit: '♥' },
            { value: 13, suit: '♠' } // King
        ];
        expect(gameUI.areCardsSplittable(cards[0], cards[1])).toBe(true);
    });

    test('doubling down restrictions', () => {
        const state = {
            gamePhase: 'playing',
            currentPlayer: 1,
            players: [{
                id: 1,
                status: 'playing',
                hands: [[
                    { value: 8, suit: '♥' },
                    { value: 9, suit: '♣' }
                ]],
                currentHand: 0
            }]
        };

        gameUI.updateControls(state);
        expect(document.getElementById('double').disabled).toBe(false);

        // Add a third card - should disable double
        state.players[0].hands[0].push({ value: 7, suit: '♦' });
        gameUI.updateControls(state);
        expect(document.getElementById('double').disabled).toBe(true);
    });
});

// Run with: npx jest tests/game.test.js --verbose
