// CES2K online multiplayer relay.
// Two players join a room by a 4-letter code. The server only forwards messages
// between them; the host's browser runs the actual game.
const http = require('http');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
// Optional: comma separated list of allowed Origins, e.g. "https://codxeditor.com"
const ALLOWED = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I or O
const MAX_ROOMS = 500;
const MAX_MSG = 64 * 1024;

const rooms = new Map(); // code -> { host, guest }
const queues = new Map(); // match settings key -> a player waiting for a random match
function unqueue(ws) { if (ws.q && queues.get(ws.q) === ws) queues.delete(ws.q); ws.q = null; }

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
    res.end('CES2K server OK. Rooms: ' + rooms.size + '\n');
});

const wss = new WebSocketServer({
    server,
    maxPayload: MAX_MSG,
    verifyClient: (info, done) => {
        if (!ALLOWED.length) return done(true);
        const o = info.origin || info.req.headers.origin || '';
        done(ALLOWED.includes(o), 403, 'Origin not allowed');
    }
});

function newCode() {
    for (let n = 0; n < 50; n++) {
        let c = '';
        for (let i = 0; i < 4; i++) c += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
        if (!rooms.has(c)) return c;
    }
    return null;
}
const sendJSON = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

function leave(ws) {
    const room = ws.room && rooms.get(ws.room);
    if (!room) return;
    if (room.host === ws) {
        sendJSON(room.guest, { t: 'left', who: 'host' });
        if (room.guest) { room.guest.room = null; }
        rooms.delete(ws.room);
    } else if (room.guest === ws) {
        room.guest = null;
        sendJSON(room.host, { t: 'peer', n: 0 });
    }
    ws.room = null;
}

wss.on('connection', ws => {
    ws.isAlive = true;
    ws.room = null;
    ws.bucket = 60; ws.bucketT = Date.now();
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (data, isBinary) => {
        // simple rate limit: ~120 msgs/sec burst 120
        const now = Date.now();
        ws.bucket = Math.min(120, ws.bucket + (now - ws.bucketT) * 0.12); ws.bucketT = now;
        if (--ws.bucket < 0) return;

        const room = ws.room && rooms.get(ws.room);
        if (isBinary) { // game snapshots: host -> guest only
            if (room && room.host === ws && room.guest) room.guest.send(data, { binary: true });
            return;
        }
        let m; try { m = JSON.parse(data.toString()); } catch (e) { return; }
        if (!m || typeof m.t !== 'string') return;

        if (m.t === 'queue') {
            if (ws.room) leave(ws);
            unqueue(ws);
            const key = String(m.k || '');
            if (!/^[1-5]-[01]-[235]$/.test(key)) return sendJSON(ws, { t: 'err', m: 'Bad match settings.' });
            const w = queues.get(key);
            if (w && w !== ws && w.readyState === 1 && !w.room) {
                const code = newCode();
                if (!code || rooms.size >= MAX_ROOMS) return sendJSON(ws, { t: 'err', m: 'Server is full, try again later.' });
                queues.delete(key); w.q = null;
                rooms.set(code, { host: w, guest: ws });
                w.room = code; ws.room = code;
                sendJSON(w, { t: 'matched', role: 'host', code });
                sendJSON(ws, { t: 'matched', role: 'guest', code });
            } else { queues.set(key, ws); ws.q = key; sendJSON(ws, { t: 'queued' }); }
            return;
        }
        if (m.t === 'unqueue') { unqueue(ws); return; }
        if (m.t === 'create') {
            unqueue(ws);
            if (ws.room) leave(ws);
            if (rooms.size >= MAX_ROOMS) return sendJSON(ws, { t: 'err', m: 'Server is full, try again later.' });
            const code = newCode();
            if (!code) return sendJSON(ws, { t: 'err', m: 'Could not create a room.' });
            rooms.set(code, { host: ws, guest: null });
            ws.room = code;
            return sendJSON(ws, { t: 'created', code });
        }
        if (m.t === 'join') {
            unqueue(ws);
            if (ws.room) leave(ws);
            const code = String(m.code || '').toUpperCase().trim();
            const r = rooms.get(code);
            if (!r) return sendJSON(ws, { t: 'err', m: 'Room ' + code + ' not found.' });
            if (r.guest) return sendJSON(ws, { t: 'err', m: 'That room is already full.' });
            r.guest = ws; ws.room = code;
            sendJSON(ws, { t: 'joined', code });
            return sendJSON(r.host, { t: 'peer', n: 1 });
        }
        // everything else is relayed to the other player in the room
        if (!room) return;
        const other = room.host === ws ? room.guest : room.host;
        if (other && other.readyState === 1) other.send(data.toString());
    });

    ws.on('close', () => { unqueue(ws); leave(ws); });
    ws.on('error', () => {});
});

// keep connections alive through Render's proxy and drop dead sockets
setInterval(() => {
    wss.clients.forEach(ws => {
        if (!ws.isAlive) return ws.terminate();
        ws.isAlive = false; ws.ping();
    });
}, 25000);

server.listen(PORT, () => console.log('CES2K server listening on ' + PORT));
