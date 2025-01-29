// public/testWorker.js
let ws = null;
let encryption = null;
let connectionAttempts = 0;

self.onmessage = function(e) {
    const message = e.data;
    
    switch(message.type) {
        case 'connect':
            connectWebSocket();
            break;
            
        default:
            sendToServer(message);
            break;
    }
};

function connectWebSocket() {
    const protocol = 'wss:';
    const host = self.location.host;
    ws = new WebSocket(`${protocol}//${host}`);

    ws.onopen = () => {
        connectionAttempts = 0;
        postMessage({ 
            type: 'connection_status', 
            status: 'connected' 
        });
    };

    ws.onclose = (event) => {
        postMessage({ 
            type: 'connection_status', 
            status: 'disconnected',
            code: event.code,
            reason: event.reason
        });
        
        // Implement reconnection with backoff
        const backoffDelay = Math.min(1000 * Math.pow(2, connectionAttempts), 30000);
        setTimeout(() => {
            connectionAttempts++;
            connectWebSocket();
        }, backoffDelay);
    };

    ws.onerror = (error) => {
        postMessage({ 
            type: 'error', 
            error: 'WebSocket error occurred'
        });
    };

    ws.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            // Here we would decrypt if encryption was enabled
            postMessage(message);
        } catch (error) {
            postMessage({ 
                type: 'error', 
                error: 'Failed to parse message' 
            });
        }
    };
}

function sendToServer(message) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        postMessage({ 
            type: 'error', 
            error: 'WebSocket not connected' 
        });
        return;
    }

    try {
        // Here we would encrypt if encryption was enabled
        ws.send(JSON.stringify(message));
    } catch (error) {
        postMessage({ 
            type: 'error', 
            error: 'Failed to send message' 
        });
    }
}
