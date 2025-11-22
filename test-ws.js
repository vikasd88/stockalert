const WebSocket = require('ws');

const url = 'wss://stockalert-dev.gemsbok-mamba.ts.net/ws/alerts';
console.log(`Connecting to ${url}...`);

const ws = new WebSocket(url);

ws.on('open', function open() {
    console.log('Connected successfully!');
    ws.close();
});

ws.on('error', function error(err) {
    console.error('Connection failed:', err.message);
    if (err.code) console.error('Error code:', err.code);
});

ws.on('close', function close(code, reason) {
    console.log(`Disconnected. Code: ${code}, Reason: ${reason}`);
});
