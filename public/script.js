
const audio = document.getElementById('radyo-audio');
const playBtn = document.getElementById('main-play-btn');
const currentTitle = document.getElementById('current-song-title');
const volumeSlider = document.getElementById('vol-control');
const playlistEl = document.getElementById('playlist-items');
const loginOverlay = document.getElementById('login-overlay');
const loginForm = document.getElementById('login-form');
const mainUI = document.getElementById('main-container');
const micBtn = document.getElementById('mic-trigger');

let playlist = [];
let currentIndex = -1;
let targetVolume = 0.5;
let fadeInterval = null;

async function checkAuth() {
    try {
        const res = await fetch('api/files');
        if (res.status === 401) {
            loginOverlay.classList.remove('hidden');
            mainUI.classList.add('hidden');
        } else {
            loginOverlay.classList.add('hidden');
            mainUI.classList.remove('hidden');
            playlist = await res.json();
            renderPlaylist();
            syncState();
        }
    } catch (e) { loginOverlay.classList.remove('hidden'); }
}

async function syncState() {
    try {
        const res = await fetch('api/sync');
        const data = await res.json();
        if (data.isPlaying && data.songName) {
            currentTitle.innerText = data.songName.split('-').slice(1).join('-').replace(/\.[^/.]+$/, "");
            currentIndex = playlist.findIndex(f => f.name === data.songName);
        }
    } catch(e) {}
}

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const res = await fetch('api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginForm.username.value, password: loginForm.password.value })
    });
    if ((await res.json()).success) checkAuth(); else document.getElementById('login-error').classList.remove('hidden');
});

function fadeTo(volume, duration = 1000, callback = null) {
    if (fadeInterval) clearInterval(fadeInterval);
    const step = (volume - audio.volume) / (duration / 50);
    fadeInterval = setInterval(() => {
        audio.volume = Math.max(0, Math.min(1, audio.volume + step));
        if (Math.abs(audio.volume - volume) < 0.05) {
            audio.volume = volume;
            clearInterval(fadeInterval);
            if (callback) callback();
        }
    }, 50);
}

async function playIndex(i) {
    if (i < 0 || i >= playlist.length) return;
    currentIndex = i;
    const f = playlist[i];
    audio.src = `uploads/${encodeURIComponent(f.name)}`;
    audio.volume = 0;
    audio.play();
    fadeTo(targetVolume);
    
    currentTitle.innerText = f.name.split('-').slice(1).join('-').replace(/\.[^/.]+$/, "");
    playBtn.innerHTML = '<i class="fas fa-pause"></i>';
    document.getElementById('current-status-text').innerText = 'ŞU AN YAYINDA';
    
    await fetch('api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ songName: f.name, isPlaying: true }) });
}

playBtn.addEventListener('click', async () => {
    if (audio.src) {
        if (audio.paused) {
            audio.play(); 
            fadeTo(targetVolume);
            playBtn.innerHTML = '<i class="fas fa-pause"></i>';
            await fetch('api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isPlaying: true }) });
        } else {
            fadeTo(0, 800, () => {
                audio.pause();
                playBtn.innerHTML = '<i class="fas fa-play"></i>';
            });
            await fetch('api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isPlaying: false }) });
        }
    } else if (playlist.length > 0) playIndex(0);
});

async function toggleMic() {
    const isActive = micBtn.classList.contains('active');
    if (!isActive) {
        try {
            await navigator.mediaDevices.getUserMedia({ audio: true });
            micBtn.classList.add('active');
            fadeTo(0.1, 500);
        } catch(e) { alert('Mikrofon izni gerek!'); }
    } else {
        micBtn.classList.remove('active');
        fadeTo(targetVolume, 500);
    }
}

micBtn.addEventListener('click', toggleMic);

window.addEventListener('keydown', (e) => {
    if (e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); toggleMic(); }
});

const renderPlaylist = () => {
    playlistEl.innerHTML = '';
    playlist.forEach((f, i) => {
        const div = document.createElement('div');
        div.className = 'playlist-item';
        // Clean display name (remove timestamp)
        const displayName = f.name.split('-').slice(1).join('-').replace(/\.[^/.]+$/, ""); 
        div.innerHTML = `
            <div class="song-wrap" onclick="playIndex(${i})">
                <i class="fas fa-music"></i> <span>${displayName}</span>
            </div>
            <div class="item-btns">
                <button onclick="renameItem(${i})" title="Yeniden Adlandır"><i class="fas fa-edit"></i></button>
                <button onclick="move(${i}, -1)"><i class="fas fa-chevron-up"></i></button>
                <button onclick="move(${i}, 1)"><i class="fas fa-chevron-down"></i></button>
                <button onclick="del(${i})"><i class="fas fa-trash-alt"></i></button>
            </div>
        `;
        playlistEl.appendChild(div);
    });
};

async function move(i, d) {
    const ni = i + d;
    if (ni < 0 || ni >= playlist.length) return;
    [playlist[i], playlist[ni]] = [playlist[ni], playlist[i]];
    renderPlaylist();
    await fetch('api/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order: playlist.map(x => x.name) }) });
}

async function del(i) {
    if (confirm('Silmek emin misiniz?')) {
        await fetch(`api/files/${encodeURIComponent(playlist[i].name)}`, { method: 'DELETE' });
        checkAuth();
    }
}

async function renameItem(i) {
    const oldName = playlist[i].name;
    const currentBase = oldName.split('-').slice(1).join('-').replace(/\.[^/.]+$/, "");
    const newBase = prompt('Yeni şarkı adını girin:', currentBase);
    if (newBase && newBase !== currentBase) {
        const res = await fetch('api/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldName, newName: oldName.split('-')[0] + '-' + newBase })
        });
        const data = await res.json();
        if (data.success) checkAuth();
        else alert('Ad değiştirme başarısız: ' + data.error);
    }
}

async function shufflePlaylist() {
    if (playlist.length < 2) return;
    for (let i = playlist.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [playlist[i], playlist[j]] = [playlist[j], playlist[i]];
    }
    renderPlaylist();
    await fetch('api/order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order: playlist.map(x => x.name) }) });
}

document.getElementById('shuffle-btn').addEventListener('click', shufflePlaylist);

volumeSlider.addEventListener('input', (e) => {
    targetVolume = e.target.value;
    if (!micBtn.classList.contains('active')) audio.volume = targetVolume;
});

function showTab(tabId) {
    document.querySelectorAll('.menu-item, .mob-menu-item').forEach(b => {
        if (b.dataset.tab === tabId) b.classList.add('active'); else b.classList.remove('active');
    });
    document.querySelectorAll('.pane').forEach(p => p.classList.add('hidden'));
    document.getElementById(`${tabId}-tab`).classList.remove('hidden');
}

document.querySelectorAll('.menu-item, .mob-menu-item').forEach(btn => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
});

const fileIn = document.getElementById('audio-input');
const uploadZone = document.getElementById('upload-zone');
uploadZone.addEventListener('click', () => fileIn.click());
fileIn.addEventListener('change', async () => {
    uploadZone.innerHTML = '<i class="fas fa-spinner fa-spin"></i><p>Yükleniyor...</p>';
    try {
        for (const file of fileIn.files) {
            const fd = new FormData();
            fd.append('audio', file);
            await fetch('api/upload', { method: 'POST', body: fd });
        }
        uploadZone.innerHTML = '<i class="fas fa-check-circle" style="color:#10b981"></i><p>Başarıyla yüklendi!</p>';
        setTimeout(() => { uploadZone.innerHTML = '<i class="fas fa-cloud-upload-alt"></i><p>Dosyaları buraya bırakın</p>'; }, 2000);
    } catch(e) {
        uploadZone.innerHTML = '<i class="fas fa-exclamation-circle" style="color:#ef4444"></i><p>Hata oluştu!</p>';
    }
    checkAuth();
});

document.getElementById('logout-btn').addEventListener('click', async () => {
    await fetch('api/logout');
    window.location.reload();
});

checkAuth();
