const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const rooms = new Map();

function generateSessionCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function sendTo(ws, message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.roomCode = null;
  ws.role = null;

  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      switch (message.type) {
        case 'create-room': {
          const code = message.code || generateSessionCode();
          rooms.set(code, { sender: ws, receiver: null });
          ws.roomCode = code;
          ws.role = 'sender';
          sendTo(ws, { type: 'room-created', code });
          break;
        }
        case 'file-meta':
        case 'file-end': {
          // Relay file transfer metadata/end markers to peer
          const room = rooms.get(ws.roomCode);
          if (room) {
            const target = ws.role === 'sender' ? room.receiver : room.sender;
            sendTo(target, message);
          }
          break;
        }
      }
    } catch (err) {
      console.error(err);
    }
  });

  ws.on('close', () => { rooms.delete(ws.roomCode); });
});

setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
