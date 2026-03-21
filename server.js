const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const session = require('express-session');
const ffmpeg = require('fluent-ffmpeg');
const { execSync } = require('child_process');

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
let isLoopEnabled = true;

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

// ==================== AUTH ROUTES ====================
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

// ==================== SYNC API ====================
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
    } else {
        currentStatus.startTime = null;
        currentStatus.source = 'none';
    }
    saveStatus();
    res.json({ status: currentStatus });
});

app.post('/api/loop', (req, res) => {
    isLoopEnabled = !isLoopEnabled;
    res.json({ loop: isLoopEnabled });
});

// ==================== FILE MANAGEMENT ====================
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

// ==================== STATIC FILES ====================
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
    if (req.url.startsWith('/api/')) return res.status(404).end();
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==================== SERVER + WEBSOCKET ====================
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Gaddar Radio Server on port ${PORT}`);
    // Auto-start playlist on boot
    setTimeout(() => {
        if (!currentPlayback) {
            console.log('Auto-starting playlist on server boot...');
            playNextInPlaylist();
        }
    }, 3000);
});

const WebSocket = require('ws');
const wss = new WebSocket.Server({ server });
let listeners = new Set();
let hosts = new Set();

wss.on('connection', (ws) => {
    ws.on('message', (data, isBinary) => {
        if (isBinary) {
            // Host mic data - relay to listeners
            if (!hosts.has(ws)) {
                hosts.add(ws);
                console.log('Host mic active.');
            }
            broadcastToAll(data, ws, true);
        } else {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.type === 'listener') {
                    listeners.add(ws);
                } else if (msg.type === 'mic_state') {
                    if (msg.active) {
                        hosts.add(ws);
                    }
                    broadcastToAll(data, ws, false);
                }
            } catch (e) {}
        }
    });
    ws.on('close', () => {
        listeners.delete(ws);
        hosts.delete(ws);
    });
    ws.on('error', () => {
        listeners.delete(ws);
        hosts.delete(ws);
    });
});

function broadcastToAll(data, sender, isBinary) {
    for (const client of wss.clients) {
        if (client !== sender && client.readyState === WebSocket.OPEN) {
            client.send(data, { binary: isBinary });
        }
    }
}

function broadcastToListeners(data) {
    for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(data, { binary: true });
        }
    }
}

function broadcastStatus() {
    const elapsed = currentStatus.isPlaying && currentStatus.startTime ? (Date.now() - currentStatus.startTime) / 1000 : 0;
    const msg = JSON.stringify({
        type: 'status',
        isPlaying: currentStatus.isPlaying,
        songName: currentStatus.songName,
        elapsed: elapsed,
        source: currentStatus.source
    });
    for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
}
setInterval(broadcastStatus, 5000);

// ==================== SERVER-SIDE AUDIO ENGINE ====================
let currentPlayback = null;   // { command, stream, fileName }
let nextPlayback = null;       // For crossfade overlap
let currentSongDuration = 0;
let fadeTimer = null;
let isFadingOut = false;

// Get song duration in seconds using ffprobe
function getSongDuration(filePath) {
    try {
        const out = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}"`, { timeout: 5000 });
        return parseFloat(out.toString().trim()) || 0;
    } catch(e) { return 0; }
}

// Get ordered playlist files
function getPlaylistFiles() {
    const uploadsDir = path.join(__dirname, 'uploads/');
    try {
        const dirFiles = fs.readdirSync(uploadsDir);
        let storedOrder = [];
        if (fs.existsSync(PLAYLIST_FILE)) {
            storedOrder = JSON.parse(fs.readFileSync(PLAYLIST_FILE, 'utf8'));
        }
        let files = storedOrder.filter(name => dirFiles.includes(name));
        dirFiles.forEach(f => { if (!files.includes(f)) files.push(f); });
        return files;
    } catch(e) { return []; }
}

// Core: Start playing a file on the server
function startPlayback(fileName, fadeInDuration = 2) {
    const filePath = path.join(__dirname, 'uploads', fileName);
    if (!fs.existsSync(filePath)) {
        console.error('File not found:', fileName);
        return null;
    }

    console.log(`▶ Playing: ${fileName}`);

    // Get duration for crossfade scheduling
    const duration = getSongDuration(filePath);
    console.log(`  Duration: ${duration.toFixed(1)}s`);

    // Build ffmpeg with fade-in filter
    const filters = [];
    if (fadeInDuration > 0) {
        filters.push(`afade=t=in:d=${fadeInDuration}`);
    }

    let cmd;
    if (filters.length > 0) {
        cmd = ffmpeg(filePath)
            .audioChannels(1)
            .audioFrequency(44100)
            .audioFilter(filters.join(','))
            .format('f32le');
    } else {
        cmd = ffmpeg(filePath)
            .audioChannels(1)
            .audioFrequency(44100)
            .format('f32le');
    }

    cmd.on('error', (err) => {
        if (!err.message.includes('SIGKILL')) {
            console.error('Playback error:', err.message);
        }
    });

    cmd.on('end', () => {
        console.log(`■ Finished: ${fileName}`);
        // If this was the current playback and no next is queued, advance playlist
        if (currentPlayback && currentPlayback.fileName === fileName && !nextPlayback) {
            currentPlayback = null;
            playNextInPlaylist();
        } else if (currentPlayback && currentPlayback.fileName === fileName && nextPlayback) {
            // Crossfade completed, next is now current
            currentPlayback = nextPlayback;
            nextPlayback = null;
        }
    });

    const stream = cmd.pipe();
    const playbackObj = { command: cmd, stream: stream, fileName: fileName, startedAt: Date.now() };

    // Fade-out volume tracking
    let fadeOutStarted = false;
    const CROSSFADE_DURATION = 3; // seconds

    stream.on('data', (chunk) => {
        const floatData = new Float32Array(chunk.buffer, chunk.byteOffset, chunk.length / 4);
        
        // Apply fade-out envelope if we're near the end
        if (duration > 0 && !fadeOutStarted) {
            const elapsed = (Date.now() - playbackObj.startedAt) / 1000;
            const fadeOutStart = duration - CROSSFADE_DURATION - 1; // Start fade 1s before crossfade point
            
            if (elapsed >= fadeOutStart && elapsed < duration) {
                // Start next song for crossfade (only once)
                if (!nextPlayback && !isFadingOut) {
                    isFadingOut = true;
                    fadeOutStarted = true;
                    console.log(`↻ Crossfade starting for: ${fileName}`);
                    
                    // Start next song immediately with fade-in
                    const files = getPlaylistFiles();
                    const idx = files.indexOf(fileName);
                    let nextIdx;
                    if (isLoopEnabled) {
                        nextIdx = (idx + 1) % files.length;
                    } else if (idx + 1 < files.length) {
                        nextIdx = idx + 1;
                    } else {
                        return; // End of playlist, no loop
                    }
                    
                    const nextFile = files[nextIdx];
                    nextPlayback = startPlayback(nextFile, CROSSFADE_DURATION);
                    if (nextPlayback) {
                        currentStatus.songName = nextFile;
                        currentStatus.startTime = Date.now();
                        saveStatus();
                        broadcastStatus();
                    }
                }
            }

            // Apply fade-out volume envelope
            if (fadeOutStarted || isFadingOut) {
                const elapsed = (Date.now() - playbackObj.startedAt) / 1000;
                const fadeProgress = Math.min(1, (elapsed - (duration - CROSSFADE_DURATION)) / CROSSFADE_DURATION);
                const volume = Math.max(0, 1 - fadeProgress);
                for (let i = 0; i < floatData.length; i++) {
                    floatData[i] *= volume;
                }
            }
        }

        // Broadcast to all connected clients
        broadcastToListeners(Buffer.from(floatData.buffer));
    });

    stream.on('error', (err) => {
        console.error('Stream error:', err.message);
    });

    return playbackObj;
}

function stopPlayback() {
    if (currentPlayback) {
        try { currentPlayback.command.kill('SIGKILL'); } catch(e) {}
        try { currentPlayback.stream.destroy(); } catch(e) {}
        currentPlayback = null;
    }
    if (nextPlayback) {
        try { nextPlayback.command.kill('SIGKILL'); } catch(e) {}
        try { nextPlayback.stream.destroy(); } catch(e) {}
        nextPlayback = null;
    }
    isFadingOut = false;
    if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; }
}

function playNextInPlaylist() {
    isFadingOut = false;
    const files = getPlaylistFiles();
    if (files.length === 0) {
        currentStatus.isPlaying = false;
        currentStatus.songName = null;
        currentStatus.source = 'none';
        saveStatus();
        broadcastStatus();
        return;
    }

    let nextFile = files[0];
    if (currentStatus.songName) {
        const idx = files.indexOf(currentStatus.songName);
        if (isLoopEnabled) {
            nextFile = files[(idx + 1) % files.length];
        } else if (idx + 1 < files.length) {
            nextFile = files[idx + 1];
        } else {
            // End of playlist
            currentStatus.isPlaying = false;
            currentStatus.songName = null;
            currentStatus.source = 'none';
            saveStatus();
            broadcastStatus();
            return;
        }
    }

    currentStatus.songName = nextFile;
    currentStatus.isPlaying = true;
    currentStatus.startTime = Date.now();
    currentStatus.source = 'server';
    saveStatus();
    broadcastStatus();

    currentPlayback = startPlayback(nextFile, 2);
}

// ==================== CONTROL API ====================
app.post('/api/play', requireAuth, (req, res) => {
    const { fileName } = req.body;
    if (!fileName) return res.status(400).json({ error: 'No file specified' });

    // Stop whatever is playing and start this file
    stopPlayback();
    
    currentStatus.songName = fileName;
    currentStatus.isPlaying = true;
    currentStatus.startTime = Date.now();
    currentStatus.source = 'server';
    saveStatus();
    broadcastStatus();

    currentPlayback = startPlayback(fileName, 0); // No fade-in for manual play
    res.json({ success: true, status: currentStatus });
});

app.post('/api/stop', requireAuth, (req, res) => {
    stopPlayback();
    currentStatus.isPlaying = false;
    currentStatus.songName = null;
    currentStatus.source = 'none';
    saveStatus();
    broadcastStatus();
    res.json({ success: true });
});

app.post('/api/next', requireAuth, (req, res) => {
    stopPlayback();
    playNextInPlaylist();
    res.json({ success: true, status: currentStatus });
});
