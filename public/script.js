const audio = document.getElementById('radyo-audio');
const playBtn = document.getElementById('main-play-btn');
const currentTitle = document.getElementById('current-song-title');
const currentArtist = document.getElementById('current-song-artist');
const volumeSlider = document.getElementById('vol-control');
const playlistEl = document.getElementById('playlist-items');
const loginView = document.getElementById('login-view');
const mainView = document.getElementById('main-view');
const loginForm = document.getElementById('login-form');
const micBtn = document.getElementById('mic-trigger');
const liveBadge = document.getElementById('live-badge');

let playlist = [];
let isPlaying = false;
let draggedItem = null;

// UI TABS
document.querySelectorAll('.nav-item[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
        document.querySelectorAll('.tab-content').forEach(p => p.classList.add('hidden'));
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        
        const targetTab = document.getElementById(`${tab}-tab`);
        if (targetTab) targetTab.classList.remove('hidden');
        btn.classList.add('active');
    });
});

// AUTHENTICATION
async function checkAuth() {
    try {
        const res = await fetch('api/auth-check');
        const data = await res.json();
        if (data.authenticated) {
            showDashboard();
        } else {
            showLogin();
        }
    } catch (e) { showLogin(); }
}

function showLogin() {
    loginView.classList.remove('hidden');
    mainView.classList.add('hidden');
}

function showDashboard() {
    loginView.classList.add('hidden');
    mainView.classList.remove('hidden');
    loadPlaylist();
    syncState();
}

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = e.target.username.value;
    const password = e.target.password.value;
    const errorEl = document.getElementById('login-error');
    
    try {
        const res = await fetch('api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        if (res.ok) {
            showDashboard();
        } else {
            errorEl.classList.remove('hidden');
            setTimeout(() => errorEl.classList.add('hidden'), 3000);
        }
    } catch (e) { alert('Bağlantı hatası!'); }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
    await fetch('api/logout');
    location.reload();
});

// HOTKEY: Shift + Z for Microphone
window.addEventListener('keydown', (e) => {
    if (e.shiftKey && (e.key === 'Z' || e.key === 'z')) {
        e.preventDefault();
        toggleMic();
    }
});

micBtn.onclick = toggleMic;

let isMicActive = false;
let baseVolume = 0.5;
let volumeFadeInterval = null;

function toggleMic() {
    isMicActive = !isMicActive;
    micBtn.classList.toggle('active', isMicActive);
    micBtn.innerHTML = isMicActive ? '<i class="fas fa-microphone-slash"></i>' : '<i class="fas fa-microphone"></i>';
    
    // Smooth volume transition (Ducking)
    const targetVolume = isMicActive ? baseVolume * 0.2 : baseVolume;
    fadeVolumeTo(targetVolume);
}

function fadeVolumeTo(target) {
    if (volumeFadeInterval) clearInterval(volumeFadeInterval);
    volumeFadeInterval = setInterval(() => {
        const step = 0.02;
        if (Math.abs(audio.volume - target) < step) {
            audio.volume = target;
            clearInterval(volumeFadeInterval);
        } else {
            audio.volume += (audio.volume < target ? step : -step);
        }
    }, 30);
}

// PLAYLIST & SYNC
async function loadPlaylist() {
    try {
        const res = await fetch('api/files');
        playlist = await res.json();
        renderPlaylist();
    } catch (e) { console.error('Playlist load error', e); }
}

function renderPlaylist() {
    playlistEl.innerHTML = '';
    playlist.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'song-item';
        div.draggable = true;
        div.dataset.index = index;
        div.innerHTML = `
            <div class="song-info">
                <div class="song-icon drag-handle"><i class="fas fa-grip-lines"></i></div>
                <span class="song-name" title="${item.name}">${item.name}</span>
            </div>
            <div class="song-actions">
                <button class="action-btn rename-this" title="Ad Değiştir"><i class="fas fa-edit"></i></button>
                <button class="action-btn play-this" title="Hemen Çal"><i class="fas fa-play"></i></button>
                <button class="action-btn del-this" title="Sil"><i class="fas fa-trash"></i></button>
            </div>
        `;
        
        div.querySelector('.play-this').onclick = () => startSong(item.name);
        div.querySelector('.del-this').onclick = () => deleteSong(item.name);
        div.querySelector('.rename-this').onclick = (e) => { e.stopPropagation(); renameSong(item.name); };
        
        // Drag and Drop
        div.addEventListener('dragstart', (e) => {
            draggedItem = index;
            div.style.opacity = '0.5';
        });
        div.addEventListener('dragend', () => {
            div.style.opacity = '1';
        });
        div.addEventListener('dragover', (e) => e.preventDefault());
        div.addEventListener('drop', (e) => {
            e.preventDefault();
            if (draggedItem !== index) {
                const newOrder = [...playlist.map(p => p.name)];
                const itemToMove = newOrder.splice(draggedItem, 1)[0];
                newOrder.splice(index, 0, itemToMove);
                saveOrder(newOrder);
            }
        });
        
        playlistEl.appendChild(div);
    });
}

async function saveOrder(order) {
    await fetch('api/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order })
    });
    loadPlaylist();
}

async function renameSong(oldName) {
    const newName = prompt('Yeni dosya adını girin (uzantı eklemeyin):', oldName.split('.').slice(0, -1).join('.'));
    if (!newName || newName === oldName) return;
    
    try {
        const res = await fetch('api/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldName, newName })
        });
        const data = await res.json();
        if (data.success) {
            loadPlaylist();
        } else {
            alert('Hata: ' + data.error);
        }
    } catch (e) { alert('İşlem başarısız.'); }
}

async function startSong(songName) {
    await fetch('api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songName, isPlaying: true })
    });
    syncState();
}

async function deleteSong(name) {
    if (!confirm('Silmek istediğine emin misin?')) return;
    await fetch(`api/files/${encodeURIComponent(name)}`, { method: 'DELETE' });
    loadPlaylist();
}

async function syncState() {
    try {
        const res = await fetch('api/sync');
        const data = await res.json();
        
        const liveText = liveBadge.querySelector('.status-text');
        const offlineText = liveBadge.querySelector('.status-text-offline');

        if (data.isPlaying && data.songName) {
            currentTitle.textContent = data.songName;
            playBtn.innerHTML = '<i class="fas fa-pause"></i>';
            playBtn.classList.add('playing');
            if(liveText) liveText.classList.remove('hidden');
            if(offlineText) offlineText.classList.add('hidden');
            
            const streamUrl = `uploads/${encodeURIComponent(data.songName)}`;
            if (audio.src !== window.location.origin + '/' + streamUrl) {
                audio.src = streamUrl;
                audio.load();
            }
            
            // Apply 5s Delay Buffer
            const delayedTime = Math.max(0, data.elapsed - 5);
            
            if (isPlaying) {
                if (audio.paused) audio.play();
                if (Math.abs(audio.currentTime - delayedTime) > 2) audio.currentTime = delayedTime;
            }
        } else {
            currentTitle.textContent = 'Yayın Bekleniyor';
            playBtn.innerHTML = '<i class="fas fa-play"></i>';
            playBtn.classList.remove('playing');
            if(liveText) liveText.classList.add('hidden');
            if(offlineText) offlineText.classList.remove('hidden');
            if (!audio.paused) audio.pause();
        }
    } catch (e) {}
}

playBtn.onclick = () => {
    isPlaying = !isPlaying;
    if (isPlaying) {
        audio.play();
        playBtn.innerHTML = '<i class="fas fa-pause"></i>';
    } else {
        audio.pause();
        playBtn.innerHTML = '<i class="fas fa-play"></i>';
    }
    syncState();
};

// UPLOAD
const zone = document.getElementById('upload-zone');
if (zone) {
    zone.onclick = () => document.getElementById('audio-input').click();

    document.getElementById('audio-input').onchange = async (e) => {
        const files = e.target.files;
        for (const file of files) {
            const formData = new FormData();
            formData.append('audio', file);
            await fetch('api/upload', { method: 'POST', body: formData });
        }
        loadPlaylist();
        alert('Dosyalar başarıyla yüklendi!');
    };
}

// INITIALIZE
if (volumeSlider) {
    volumeSlider.oninput = (e) => {
        baseVolume = parseFloat(e.target.value);
        if (!isMicActive) audio.volume = baseVolume;
        else audio.volume = baseVolume * 0.2;
    };
}
setInterval(syncState, 5000);
checkAuth();
