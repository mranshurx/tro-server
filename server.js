/**
 * AirBeam P2P - WebRTC Signaling Server
 * 
 * Production-ready WebSocket signaling server for peer-to-peer file transfer.
 * Handles room creation, session code pairing, and chunk/metadata relay.
 */

const http = require('http');
const path = require('path');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Serve static public folder if exists
app.use(express.static(path.join(__dirname, 'public')));

// Root status page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>AirBeam P2P Signaling Server</title>
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body class="bg-slate-950 text-slate-100 min-h-screen flex items-center justify-center p-6 font-sans">
      <div class="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 shadow-2xl text-center space-y-4">
        <div class="w-16 h-16 rounded-2xl bg-sky-500/20 text-sky-400 flex items-center justify-center mx-auto text-2xl font-bold">
          🛰️
        </div>
        <h1 class="text-xl font-bold text-white">AirBeam Signaling Server</h1>
        <p class="text-xs text-slate-400">
          WebSocket signaling server is online and active. Your Android P2P app is connected to this backend for WebRTC session pairing.
        </p>
        <div class="pt-2">
          <span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-semibold border border-emerald-500/20">
            <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> Status: Online & Healthy
          </span>
        </div>
      </div>
    </body>
    </html>
  `);
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
          console.log(`Room created: ${code}`);
          break;
        }
        case 'file-meta':
        case 'file-end': {
          const room = rooms.get(ws.roomCode);
          if (room) {
            const target = ws.role === 'sender' ? room.receiver : room.sender;
            sendTo(target, message);
          }
          break;
        }
        default: {
          const room = rooms.get(ws.roomCode);
          if (room) {
            const target = ws.role === 'sender' ? room.receiver : room.sender;
            sendTo(target, message);
          }
          break;
        }
      }
    } catch (err) {
      console.error('Message error:', err);
    }
  });

  ws.on('close', () => {
    if (ws.roomCode) {
      rooms.delete(ws.roomCode);
    }
  });
});

// Heartbeat
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`AirBeam Signaling Server running on port ${PORT}`);
});
