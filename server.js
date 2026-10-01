const express = require('express');
const http = require('http');
const path = require('path');
const os = require('os');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const WebSocket = require('ws');
const QRCode = require('qrcode');

let PORT = process.env.PORT || 3000;
const NATIVE_DIR = path.join(__dirname, 'native');
const BRIDGE_PATH = path.join(NATIVE_DIR, 'InputBridge.exe');
const BRIDGE_SOURCE = path.join(NATIVE_DIR, 'InputBridge.cs');

// --- C# InputBridge Manager ---
let bridgeProcess = null;
let cursorSize = 32;
let cursorLarge = false;

function ensureBridgeCompiled() {
  if (!fs.existsSync(BRIDGE_PATH)) {
    console.log('[Bridge] InputBridge.exe not found, compiling from source...');
    const csc = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
    if (!fs.existsSync(csc)) {
      throw new Error(`csc.exe not found at ${csc}`);
    }
    const cmd = `"${csc}" /nologo /optimize /target:exe /out:"${BRIDGE_PATH}" "${BRIDGE_SOURCE}"`;
    execSync(cmd, { stdio: 'inherit' });
    console.log('[Bridge] Successfully compiled InputBridge.exe');
  }
}

function startBridge() {
  ensureBridgeCompiled();
  bridgeProcess = spawn(BRIDGE_PATH, [], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  bridgeProcess.stdout.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg) console.log(`[Bridge Out] ${msg}`);
  });

  bridgeProcess.stderr.on('data', (data) => {
    const err = data.toString().trim();
    if (err) console.error(`[Bridge Err] ${err}`);
  });

  bridgeProcess.on('close', (code) => {
    console.log(`[Bridge] Process exited with code ${code}`);
    bridgeProcess = null;
  });

  bridgeProcess.on('error', (err) => {
    console.error(`[Bridge] Failed to start:`, err);
  });
}

function sendBridgeCommand(cmd) {
  if (bridgeProcess && bridgeProcess.stdin && !bridgeProcess.stdin.destroyed) {
    try {
      bridgeProcess.stdin.write(cmd + '\n');
    } catch (e) {
      console.error('[Bridge] Error writing to stdin:', e.message);
    }
  }
}

function setCursorScale(scale) {
  const s = String(scale).toUpperCase();
  if (s === '32' || s === 'NORMAL' || s === 'RESET') {
    sendBridgeCommand('CURSOR_SCALE NORMAL');
    cursorSize = 32;
    cursorLarge = false;
  } else if (s === '72' || s === 'LARGE') {
    sendBridgeCommand('CURSOR_SCALE LARGE');
    cursorSize = 72;
    cursorLarge = true;
  } else if (s === '96' || s === 'XLARGE') {
    sendBridgeCommand('CURSOR_SCALE XLARGE');
    cursorSize = 96;
    cursorLarge = true;
  } else if (s === 'TOGGLE') {
    if (cursorLarge) {
      setCursorScale('32');
    } else {
      setCursorScale('72');
    }
    return;
  }
  broadcastStatus();
}

function setMagnifier(state) {
  const s = String(state).toUpperCase();
  sendBridgeCommand(`MAGNIFIER ${s}`);
}

// --- Network Detection ---
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(interfaces)) {
    const lowerName = name.toLowerCase();
    // Exclude virtual adapters
    const isVirtual = lowerName.includes('vethernet') ||
                      lowerName.includes('wsl') ||
                      lowerName.includes('vmware') ||
                      lowerName.includes('virtualbox') ||
                      lowerName.includes('hyper-v') ||
                      lowerName.includes('tap') ||
                      lowerName.includes('docker') ||
                      lowerName.includes('pseudo') ||
                      lowerName.includes('loopback');

    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        let priority = 10;
        if (isVirtual) priority = 1;
        else if (iface.address.startsWith('192.168.')) priority = 100;
        else if (iface.address.startsWith('10.')) priority = 90;
        else if (iface.address.startsWith('172.')) priority = 50;

        addresses.push({
          name,
          address: iface.address,
          priority
        });
      }
    }
  }

  // Sort descending by priority
  addresses.sort((a, b) => b.priority - a.priority);
  return addresses;
}

function getPrimaryIp() {
  const list = getLocalIpAddresses();
  return list.length > 0 ? list[0].address : '127.0.0.1';
}

// --- Express App & HTTP Server ---
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/api/status', (req, res) => {
  const ips = getLocalIpAddresses();
  res.json({
    ips,
    primaryIp: getPrimaryIp(),
    port: PORT,
    clientCount: wss.clients.size,
    cursorSize,
    cursorLarge
  });
});

app.get('/api/qr', async (req, res) => {
  try {
    const ip = req.query.ip || getPrimaryIp();
    const url = `http://${ip}:${PORT}`;
    const dataUrl = await QRCode.toDataURL(url, {
      margin: 2,
      width: 300,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });
    res.json({ url, dataUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- WebSocket Management ---
let listeners = {
  clientConnected: null,
  clientDisconnected: null
};

function broadcast(msgObj) {
  const json = JSON.stringify(msgObj);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  }
}

function broadcastStatus() {
  broadcast({
    t: 'status',
    cursorLarge,
    cursorSize,
    clientCount: wss.clients.size
  });
}

wss.on('connection', (ws) => {
  const clientCount = wss.clients.size;
  console.log(`[WS] Client connected. Total: ${clientCount}`);

  // Auto-scale cursor to 72px on first smartphone connection
  if (clientCount === 1) {
    setCursorScale('72');
  }

  if (typeof listeners.clientConnected === 'function') {
    listeners.clientConnected(clientCount);
  }

  // Send initial status
  ws.send(JSON.stringify({
    t: 'status',
    cursorLarge,
    cursorSize,
    clientCount
  }));

  broadcast({ t: 'clients', count: clientCount });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      handleWsMessage(ws, data);
    } catch (e) {
      console.error('[WS] Invalid JSON received:', message);
    }
  });

  ws.on('close', () => {
    const remaining = wss.clients.size;
    console.log(`[WS] Client disconnected. Remaining: ${remaining}`);

    if (typeof listeners.clientDisconnected === 'function') {
      listeners.clientDisconnected(remaining);
    }

    // Auto-restore cursor to 32px when all clients disconnect
    if (remaining === 0) {
      setCursorScale('32');
    }

    broadcast({ t: 'clients', count: remaining });
    broadcastStatus();
  });
});

function handleWsMessage(ws, data) {
  switch (data.t) {
    case 'm': // Move
      if (typeof data.x === 'number' && typeof data.y === 'number') {
        sendBridgeCommand(`MOVE ${Math.round(data.x)} ${Math.round(data.y)}`);
      }
      break;

    case 'c': // Click
      sendBridgeCommand(`CLICK ${data.b || 'left'}`);
      break;

    case 'down': // MouseDown
      sendBridgeCommand(`MOUSEDOWN ${data.b || 'left'}`);
      break;

    case 'up': // MouseUp
      sendBridgeCommand(`MOUSEUP ${data.b || 'left'}`);
      break;

    case 'w': // Scroll
      sendBridgeCommand(`SCROLL ${Math.round(data.y || 0)} ${Math.round(data.x || 0)}`);
      break;

    case 'text': // Unicode text input
      if (typeof data.text === 'string' && data.text.length > 0) {
        sendBridgeCommand(`TYPE ${data.text}`);
      }
      break;

    case 'key': // Key or combo
      if (typeof data.key === 'string' && data.key.length > 0) {
        sendBridgeCommand(`KEY ${data.key}`);
      }
      break;

    case 'cursor': // Cursor scaling
      setCursorScale(data.scale || 'toggle');
      break;

    case 'magnifier': // Magnifier
      setMagnifier(data.state || 'toggle');
      break;

    case 'ping': // Ping / Keep-alive
      ws.send(JSON.stringify({ t: 'pong' }));
      break;

    default:
      console.warn('[WS] Unknown message type:', data.t);
      break;
  }
}

// Cleanup on exit
function cleanup() {
  if (bridgeProcess) {
    sendBridgeCommand('EXIT');
    try { bridgeProcess.kill(); } catch (e) {}
    bridgeProcess = null;
  }
}

process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
process.on('exit', () => { cleanup(); });

function startServer(port = PORT) {
  PORT = port;
  return new Promise((resolve, reject) => {
    startBridge();
    server.listen(port, () => {
      const primaryIp = getPrimaryIp();
      const url = `http://${primaryIp}:${port}`;
      console.log(`\n======================================================`);
      console.log(`🚀 PC Remote Controller Server running!`);
      console.log(`📡 Local Web URL: ${url}`);
      console.log(`======================================================\n`);

      QRCode.toString(url, { type: 'terminal', small: true }, (err, qrText) => {
        if (!err && qrText) {
          console.log(qrText);
        }
      });

      resolve({ server, port, primaryIp, url });
    }).on('error', reject);
  });
}

// If executed directly: `node server.js`
if (require.main === module) {
  startServer().catch(err => {
    console.error('Failed to start server:', err);
  });
}

module.exports = {
  app,
  server,
  wss,
  startServer,
  sendBridgeCommand,
  setCursorScale,
  setMagnifier,
  getLocalIpAddresses,
  getPrimaryIp,
  setEventListeners: (evts) => { listeners = { ...listeners, ...evts }; },
  getStatus: () => ({
    cursorSize,
    cursorLarge,
    clientCount: wss.clients.size,
    primaryIp: getPrimaryIp(),
    port: PORT
  })
};
