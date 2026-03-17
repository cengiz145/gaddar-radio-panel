const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const session = require('express-session');

const app = express();
const PORT = 4005;

app.set('trust proxy', 1);
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());

app.use(session({
    name: 'gaddar_radio_sid',
    secret: 'gaddar-secret-17',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

const AUTH = { user: 'gaddarbilgi', pass: 'gaddarblg17' };

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === AUTH.user && password === AUTH.pass) {
        req.session.authenticated = true;
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Geçersiz credentials' });
    }
});

app.get('/api/auth-check', (req, res) => {
    res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// Minimal catch-all
app.get('/:any*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => console.log(`Production Radio online on ${PORT}`));
