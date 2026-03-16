const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const session = require('express-session');

const app = express();
const PORT = 4005;

app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type'] }));
app.use(express.json());

app.use('/api', (req, res, next) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    next();
});

app.use(session({
    secret: 'gaddar-test-secret-17',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

const AUTH = { user: 'gaddarbilgi', pass: 'gaddarblg1' };
const PLAYLIST_FILE = path.join(__dirname, 'playlist_order.json');
const STATUS_FILE = path.join(__dirname, 'current_status.json');

const requireAuth = (req, res, next) => {
    if (req.session && req.session.authenticated) return next();
    res.status(401).json({ error: 'Unauthorized' });
};

let currentStatus = { songName: null, startTime: null, isPlaying: false };
let isLoopEnabled = false; // LOOP STATE

if (fs.existsSync(STATUS_FILE)) {
    try { 
        const data = fs.readFileSync(STATUS_FILE, 'utf8');
        if (data) currentStatus = JSON.parse(data); 
    } catch(e) { console.error('Status read error', e); }
}

const saveStatus = () => {
    try { fs.writeFileSync(STATUS_FILE, JSON.stringify(currentStatus)); } catch(e) { console.error('Status save error', e); }
};

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === AUTH.user && password === AUTH.pass) {
        req.session.authenticated = true;
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Geçersiz kullanıcı adı veya şifre' });
    }
});

app.get('/api/auth-check', (req, res) => {
    res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

app.get('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.post('/api/loop', (req, res) => {
    isLoopEnabled = !isLoopEnabled;
    res.json({ loop: isLoopEnabled });
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/sync', (req, res) => {
    if (!currentStatus.isPlaying || !currentStatus.songName) return res.json({ isPlaying: false, loop: isLoopEnabled });
    const elapsed = (Date.now() - (currentStatus.startTime || Date.now())) / 1000;
    res.json({ isPlaying: true, songName: currentStatus.songName, elapsed: elapsed, loop: isLoopEnabled });
});

app.post('/api/sync', requireAuth, (req, res) => {
    const { songName, isPlaying } = req.body;
    currentStatus.songName = songName || currentStatus.songName;
    currentStatus.isPlaying = isPlaying;
    currentStatus.startTime = isPlaying ? Date.now() : null;
    saveStatus();
    res.json({ message: 'Status updated' });
});

const upload = multer({ 
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const dir = path.join(__dirname, 'uploads/');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename: (req, file, cb) => {
            cb(null, Date.now() + '-' + Buffer.from(file.originalname, 'latin1').toString('utf8'));
        }
    }),
    limits: { fileSize: 100 * 1024 * 1024 }
});

app.get('/api/files', (req, res) => {
    const uploadsDir = path.join(__dirname, 'uploads/');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    fs.readdir(uploadsDir, (err, files) => {
        if (err) return res.status(500).json({ error: 'Folder error' });
        let storedOrder = [];
        if (fs.existsSync(PLAYLIST_FILE)) {
            try { 
                const data = fs.readFileSync(PLAYLIST_FILE, 'utf8');
                if (data) storedOrder = JSON.parse(data); 
            } catch(e) { console.error('Order read error', e); }
        }
        let sortedFiles = storedOrder.filter(name => files.includes(name));
        files.forEach(f => { if (!sortedFiles.includes(f)) sortedFiles.push(f); });
        res.json(sortedFiles.map(f => ({ name: f, url: `/uploads/${encodeURIComponent(f)}` })));
    });
});

app.post('/api/upload', requireAuth, upload.single('audio'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file' });
        let order = [];
        if (fs.existsSync(PLAYLIST_FILE)) {
            try { 
                const data = fs.readFileSync(PLAYLIST_FILE, 'utf8');
                if (data) order = JSON.parse(data); 
            } catch(e) {}
        }
        order.push(req.file.filename);
        fs.writeFileSync(PLAYLIST_FILE, JSON.stringify(order));
        res.json({ message: 'Uploaded', file: req.file.filename });
    } catch (e) {
        res.status(500).json({ error: 'Upload failed' });
    }
});

const logoUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            cb(null, path.join(__dirname, 'public/'));
        },
        filename: (req, file, cb) => {
            cb(null, 'logo.png');
        }
    }),
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit for logo
});

app.post('/api/upload-logo', requireAuth, logoUpload.single('logo'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Resim dosyası seçilmedi' });
    res.json({ message: 'Logo başarıyla güncellendi' });
});

app.post('/api/order', requireAuth, (req, res) => {
    try {
        fs.writeFileSync(PLAYLIST_FILE, JSON.stringify(req.body.order));
        res.json({ message: 'Order saved' });
    } catch(e) {
        res.status(500).json({ error: 'Order save failed' });
    }
});

app.post('/api/rename', requireAuth, (req, res) => {
    const { oldName, newName } = req.body;
    if (!oldName || !newName) return res.status(400).json({ error: 'Missing names' });
    const ext = path.extname(oldName);
    const sanitizedNewName = newName.replace(/[\\/:*?"<>|]/g, "") + ext;
    const oldPath = path.join(__dirname, 'uploads', oldName);
    const newPath = path.join(__dirname, 'uploads', sanitizedNewName);
    if (!fs.existsSync(oldPath)) return res.status(404).json({ error: 'File not found' });
    if (fs.existsSync(newPath)) return res.status(400).json({ error: 'File already exists' });
    try {
        fs.renameSync(oldPath, newPath);
        if (fs.existsSync(PLAYLIST_FILE)) {
            let data = fs.readFileSync(PLAYLIST_FILE, 'utf8');
            let order = data ? JSON.parse(data) : [];
            order = order.map(n => n === oldName ? sanitizedNewName : n);
            fs.writeFileSync(PLAYLIST_FILE, JSON.stringify(order));
        }
        if (currentStatus.songName === oldName) {
            currentStatus.songName = sanitizedNewName;
            saveStatus();
        }
        res.json({ success: true, newName: sanitizedNewName });
    } catch(e) {
        res.status(500).json({ error: 'Rename failed' });
    }
});

app.delete('/api/files/:name', requireAuth, (req, res) => {
    try {
        const fileName = decodeURIComponent(req.params.name);
        const filePath = path.join(__dirname, 'uploads', fileName);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        if (fs.existsSync(PLAYLIST_FILE)) {
            try {
                const data = fs.readFileSync(PLAYLIST_FILE, 'utf8');
                let order = data ? JSON.parse(data) : [];
                order = order.filter(n => n !== fileName);
                fs.writeFileSync(PLAYLIST_FILE, JSON.stringify(order));
            } catch(e) {}
        }
        res.json({ message: 'Deleted' });
    } catch(e) {
        res.status(500).json({ error: 'Delete failed' });
    }
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
const server = app.listen(PORT, '0.0.0.0', () => console.log(`Production Radio (Domain Proxy) running on ${PORT}`));
const WebSocket = require('ws');
const wss = new WebSocket.Server({ server });
let listeners = new Set();
wss.on('connection', (ws) => {
    ws.on('message', (msg) => {
        if (typeof msg === 'string') {
            try { if (JSON.parse(msg).type === 'listener') listeners.add(ws); } catch(e) {}
        } else {
            for (const l of listeners) if (l.readyState === WebSocket.OPEN) l.send(msg);
        }
    });
    ws.on('close', () => listeners.delete(ws));
});
