// public/gameWorker.js
let ws = null;
let baseUrl = null;
let token = null;
let isWebSocketConnected = false;
let messageQueue = [];

function isGameReady() {
    return isWebSocketConnected;
}

async function sendToServer(message) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        messageQueue.push(message);
        return;
    }
    
    ws.send(JSON.stringify(message));
}

function connectWebSocket(token) {
    if (!baseUrl) {
        console.error('No base URL provided');
        postMessage({ type: 'error', error: 'Worker not initialized with base URL' });
        return;
    }

    console.log('Attempting WebSocket connection to:', baseUrl);
    const wsUrl = `wss://${baseUrl}:4444?token=${token}`;
    console.log('WebSocket URL:', wsUrl);

    try {
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('WebSocket connection established');
            isWebSocketConnected = true;
            postMessage({ type: 'connection_status', status: 'connected' });

            while (messageQueue.length > 0) {
                const queuedMessage = messageQueue.shift();
                sendToServer(queuedMessage);
            }
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            postMessage({ type: 'error', error: 'WebSocket connection failed' });
        };

        ws.onclose = (event) => {
            console.log('WebSocket closed:', event.code, event.reason);
            isWebSocketConnected = false;
            postMessage({ 
                type: 'connection_status', 
                status: 'disconnected',
                code: event.code,
                reason: event.reason
            });
        };

        ws.onmessage = (event) => {
            console.log('Received message:', event.data);
            try {
                const message = JSON.parse(event.data);
                handleServerMessage(message);
            } catch (error) {
                console.error('Failed to parse message:', error);
                postMessage({ type: 'error', error: 'Failed to parse message' });
            }
        };
    } catch (error) {
        console.error('Failed to create WebSocket:', error);
        postMessage({ type: 'error', error: 'Failed to create WebSocket connection' });
    }
}


function handleServerMessage(message) {
    switch (message.type) {
        case 'state_update':
            postMessage({ type: 'state_update', data: message.data });
            break;
        case 'error':
            postMessage({ type: 'error', error: message.message });
            break;
        default:
            postMessage({ type: 'unknown_message', data: message });
    }
}

// Handle messages from the main thread
self.onmessage = (event) => {
    const message = event.data;

    switch (message.type) {
        case 'init':
            baseUrl = message.baseUrl;
            token = message.token;  // Save the token
            break;
         
        case 'connect':
            if (!token) {
                postMessage({ type: 'error', error: 'No token available. Please initialize first.' });
                return;
            }
            connectWebSocket(token);
            break;
        
        case 'join_table':
            sendToServer({
                type: 'join_table',
                tableId: message.tableId
            });
            break;
        
        case 'place_bet':
            sendToServer({
                type: 'place_bet',
                amount: message.amount
            });
            break;
        
        case 'action':
            sendToServer({
                type: 'action',
                action: message.action
            });
            break;
        
        default:
            postMessage({ type: 'error', error: 'Unknown command' });
    }
};

let connectionAttempts = 0;
const MAX_BACKOFF_DELAY = 30000; // Maximum delay of 30 seconds

function calculateBackoff(attempts) {
    // Exponential backoff with jitter
    const delay = Math.min(1000 * Math.pow(2, attempts), MAX_BACKOFF_DELAY);
    const jitter = Math.random() * 100; // Add random jitter to prevent thundering herd
    return delay + jitter;
}

