const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const session = require('express-session');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
const PORT = 4005;

app.set('trust proxy', 1);

app.use(cors({ 
    origin: true, 
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

app.use((req, res, next) => {
    if (!req.url.includes('/api/sync')) {
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    }
    next();
});

app.use(session({
    name: 'gaddar_radio_sid',
    secret: 'gaddar-secret-key-1788-stable',
    resave: true, 
    saveUninitialized: true,
    cookie: { 
        secure: false, 
        httpOnly: false, 
        path: '/',
        maxAge: 30 * 24 * 60 * 60 * 1000 
    }
}));

const AUTH = { user: 'gaddarbilgi', pass: 'gaddarblg17' };
const PLAYLIST_FILE = path.join(__dirname, 'playlist_order.json');
const STATUS_FILE = path.join(__dirname, 'current_status.json');

const requireAuth = (req, res, next) => {
    if (req.session && req.session.authenticated) {
        return next();
    }
    res.status(401).json({ error: 'Unauthorized' });
};

let currentStatus = { songName: null, startTime: null, isPlaying: false, source: 'none' };
let isLoopEnabled = true; // Auto-DJ usually wants loop

if (fs.existsSync(STATUS_FILE)) {
    try { 
        const data = fs.readFileSync(STATUS_FILE, 'utf8');
        if (data) {
            const parsed = JSON.parse(data);
            currentStatus = { ...currentStatus, ...parsed };
        }
    } catch(e) {}
}

const saveStatus = () => {
    try { fs.writeFileSync(STATUS_FILE, JSON.stringify(currentStatus)); } catch(e) {}
};

app.post('/api/login', (req, res) => {
    const { password } = req.body;
    if (password === AUTH.pass) {
        req.session.authenticated = true;
        req.session.save(() => res.json({ success: true }));
    } else {
        res.status(401).json({ error: 'Geçersiz şifre' });
    }
});

app.get('/api/auth-check', (req, res) => {
    res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

app.get('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/sync', (req, res) => {
    const elapsed = currentStatus.isPlaying && currentStatus.startTime ? (Date.now() - currentStatus.startTime) / 1000 : 0;
    res.json({ 
        isPlaying: currentStatus.isPlaying, 
        songName: currentStatus.songName, 
        elapsed: elapsed, 
        loop: isLoopEnabled,
        source: currentStatus.source
    });
});

app.post('/api/sync', requireAuth, (req, res) => {
    const { songName, isPlaying } = req.body;
    if (songName !== undefined) currentStatus.songName = songName;
    if (isPlaying !== undefined) currentStatus.isPlaying = isPlaying;
    
    if (currentStatus.isPlaying) {
        currentStatus.startTime = Date.now();
        currentStatus.source = 'host';
        stopAutoDJ(); // Stop auto-dj if host starts playing
    } else {
        currentStatus.startTime = null;
        currentStatus.source = 'none';
        // Auto-DJ might start after a delay or on socket close
    }
    
    saveStatus();
    res.json({ status: currentStatus });
});

app.post('/api/loop', (req, res) => {
    isLoopEnabled = !isLoopEnabled;
    res.json({ loop: isLoopEnabled });
});

const upload = multer({ 
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const dir = path.join(__dirname, 'uploads/');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename: (req, file, cb) => {
            cb(null, Buffer.from(file.originalname, 'latin1').toString('utf8'));
        }
    }),
    limits: { fileSize: 100 * 1024 * 1024 }
});

app.get('/api/files', (req, res) => {
    const uploadsDir = path.join(__dirname, 'uploads/');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    fs.readdir(uploadsDir, (err, files) => {
        if (err) return res.json([]);
        let storedOrder = [];
        if (fs.existsSync(PLAYLIST_FILE)) {
            try { storedOrder = JSON.parse(fs.readFileSync(PLAYLIST_FILE, 'utf8')); } catch(e) {}
        }
        let sortedFiles = storedOrder.filter(name => files.includes(name));
        files.forEach(f => { if (!sortedFiles.includes(f)) sortedFiles.push(f); });
        res.json(sortedFiles.map(f => ({ name: f })));
    });
});

app.post('/api/upload', requireAuth, upload.single('audio'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file' });
        res.json({ message: 'Uploaded' });
    } catch (e) { res.status(500).json({ error: 'Upload failed' }); }
});

app.post('/api/order', requireAuth, (req, res) => {
    try {
        fs.writeFileSync(PLAYLIST_FILE, JSON.stringify(req.body.order));
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: 'Order save failed' }); }
});

app.post('/api/rename', requireAuth, (req, res) => {
    const { oldName, newName } = req.body;
    const sanitizedNewName = newName.replace(/[\\/:*?"<>|]/g, "") + path.extname(oldName);
    const oldPath = path.join(__dirname, 'uploads', oldName);
    const newPath = path.join(__dirname, 'uploads', sanitizedNewName);
    try {
        fs.renameSync(oldPath, newPath);
        if (currentStatus.songName === oldName) currentStatus.songName = sanitizedNewName;
        saveStatus();
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: 'Rename failed' }); }
});

app.delete('/api/files/:name', requireAuth, (req, res) => {
    try {
        const fileName = decodeURIComponent(req.params.name);
        const filePath = path.join(__dirname, 'uploads', fileName);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ error: 'Delete failed' }); }
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
    if (req.url.startsWith('/api/')) return res.status(404).end();
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const server = app.listen(PORT, '0.0.0.0', () => console.log(`Stable Radio Production on ${PORT}`));

const WebSocket = require('ws');
const wss = new WebSocket.Server({ server });
let listeners = new Set();
let hosts = new Set();
let micTrafficCount = 0;

// AUTO-DJ GLOBAL STATE
let autoDJCommand = null;
let currentAutoDJFile = null;

wss.on('connection', (ws) => {
    ws.on('message', (data, isBinary) => {
        if (isBinary) {
            // If it's binary data (mic), this is a host
            if (!hosts.has(ws)) {
                hosts.add(ws);
                console.log('Host detected via binary mic data. Stopping Auto-DJ.');
                stopAutoDJ();
                currentStatus.isPlaying = true;
                currentStatus.source = 'host';
                saveStatus();
            }
            micTrafficCount++;
            broadcastToListeners(data, ws, true);
        } else {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.type === 'listener') {
                    listeners.add(ws);
                    console.log('New listener registered via WS');
                } else if (msg.type === 'mic_state') {
                    if (msg.active) {
                        hosts.add(ws);
                        stopAutoDJ();
                        currentStatus.source = 'host';
                    } else {
                        // host stop mic, but might still be playing music
                    }
                }
                broadcastToListeners(data, ws, false);
            } catch (e) { }
        }
    });

    ws.on('close', () => {
        listeners.delete(ws);
        if (hosts.has(ws)) {
            hosts.delete(ws);
            console.log('Host disconnected.');
            if (hosts.size === 0) {
                console.log('No hosts left. Scheduling Auto-DJ...');
                setTimeout(checkAndStartAutoDJ, 5000);
            }
        }
    });
    ws.on('error', () => {
        listeners.delete(ws);
        hosts.delete(ws);
    });
});

function broadcastToListeners(data, sender, isBinary) {
    for (const client of listeners) {
        if (client !== sender && client.readyState === WebSocket.OPEN) {
            client.send(data, { binary: isBinary });
        }
    }
}

// Unified Playback Control
function startServerPlayback(fileName, source = 'server') {
    if (autoDJCommand) stopServerPlayback();

    const filePath = path.join(__dirname, 'uploads', fileName);
    if (!fs.existsSync(filePath)) {
        console.error('Server Playback: File not found', fileName);
        currentAutoDJFile = null;
        if (source === 'server') setTimeout(checkAndStartAutoDJ, 2000);
        return;
    }

    console.log(`Server Playback [${source}]: Playing ${fileName}`);
    currentAutoDJFile = fileName;
    currentStatus.songName = fileName;
    currentStatus.isPlaying = true;
    currentStatus.startTime = Date.now();
    currentStatus.source = source;
    saveStatus();

    const command = ffmpeg(filePath)
        .audioChannels(1)
        .audioFrequency(44100)
        .format('f32le')
        .on('error', (err) => {
            if (!err.message.includes('SIGKILL') && !err.message.includes('string size must be')) {
                console.error('Server Playback Error:', err.message);
                stopServerPlayback();
                if (source === 'server' || hosts.size === 0) setTimeout(checkAndStartAutoDJ, 5000);
            }
        })
        .on('end', () => {
            console.log(`Server Playback Finished: ${fileName}`);
            autoDJCommand = null;
            // Always check for next song
            setTimeout(checkAndStartAutoDJ, 100);
        });

    const ffStream = command.pipe();
    autoDJCommand = { command: command, stream: ffStream };

    ffStream.on('data', (chunk) => {
        broadcastToListeners(chunk, null, true);
    });

    ffStream.on('error', (err) => {
        console.error('Server Playback Stream error:', err);
        stopServerPlayback();
        setTimeout(checkAndStartAutoDJ, 5000);
    });
}

function stopServerPlayback() {
    if (autoDJCommand) {
        console.log('Stopping Server Playback.');
        if (autoDJCommand.command) autoDJCommand.command.kill('SIGKILL');
        if (autoDJCommand.stream) autoDJCommand.stream.destroy();
        autoDJCommand = null;
    }
}

// API for remote control
app.post('/api/play', requireAuth, (req, res) => {
    const { fileName } = req.body;
    if (!fileName) return res.status(400).json({ error: 'No file specified' });
    startServerPlayback(fileName, 'host');
    res.json({ success: true, status: currentStatus });
});

app.post('/api/stop', requireAuth, (req, res) => {
    stopServerPlayback();
    currentStatus.isPlaying = false;
    currentStatus.songName = null;
    currentStatus.source = 'none';
    saveStatus();
    res.json({ success: true });
});

// AUTO-DJ IMPLEMENTATION (Helper for loop/auto logic)
async function checkAndStartAutoDJ() {
    // If a host manually started something, we might want to respect it OR keep looping it?
    // User wants "Continuous". 
    if (autoDJCommand) return; // Something is already playing

    console.log('Auto-DJ session check...');
    
    const uploadsDir = path.join(__dirname, 'uploads/');
    let files = [];
    try {
        const dirFiles = fs.readdirSync(uploadsDir);
        let storedOrder = [];
        if (fs.existsSync(PLAYLIST_FILE)) {
            storedOrder = JSON.parse(fs.readFileSync(PLAYLIST_FILE, 'utf8'));
        }
        files = storedOrder.filter(name => dirFiles.includes(name));
        dirFiles.forEach(f => { if (!files.includes(f)) files.push(f); });
    } catch (e) {
        return;
    }

    if (files.length === 0) return;

    let fileToPlay = files[0];
    if (currentAutoDJFile) {
        const idx = files.indexOf(currentAutoDJFile);
        if (idx !== -1 && idx < files.length - 1) {
            fileToPlay = files[idx + 1];
        } else if (isLoopEnabled) {
            fileToPlay = files[0];
        } else {
            return; // No loop, end of playlist
        }
    }
    
    startServerPlayback(fileToPlay, 'server');
}

// Initial check on boot
setTimeout(checkAndStartAutoDJ, 5000);
