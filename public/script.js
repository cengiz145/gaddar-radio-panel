const loginLayer = document.getElementById('login-layer');
const loginForm = document.getElementById('login-form');
const mainUI = document.getElementById('main-dashboard');
const micBtn = document.getElementById('mic-trigger');
const streamStartBtn = document.getElementById('stream-start-btn');
const streamStopBtn = document.getElementById('stream-stop-btn');
const musicPlayBtn = document.getElementById('music-play-btn');
const musicStopBtn = document.getElementById('music-stop-btn');
const loopBtn = document.getElementById('loop-btn');
const monitorMuteBtn = document.getElementById('monitor-mute-btn');
let isLoopEnabled = false;
const playlistEl = document.getElementById('playlist-items');
const currentTitle = document.getElementById('current-title');
const liveIndicator = document.getElementById('live-indicator');

// Mixer & VU Meters
const volMusicFader = document.getElementById('vol-music');
const volMicFader = document.getElementById('vol-mic');
const vuMusicBar = document.getElementById('vu-music');
const vuMicBar = document.getElementById('vu-mic');

// FX Controls
const monToggle = document.getElementById('mon-toggle');
const echoToggle = document.getElementById('echo-toggle');
const reverbToggle = document.getElementById('reverb-toggle');
const echoBadge = document.getElementById('fx-badge-echo');
const reverbBadge = document.getElementById('fx-badge-reverb');

let playlist = [];
let currentIndex = -1;
let audio = document.getElementById('radyo-audio');
audio.crossOrigin = "anonymous";
let socket = null;

// Audio Engine Components
let audioContext = null;
let musicSource = null;
let musicGain = null;
let musicAnalyzer = null;

let micStream = null;
let micSource = null;
let micGain = null;
let micAnalyzer = null;
let micProcessor = null;

let listenerCtx = null;
let listenerGain = null;
let isMicActive = false;

// FX Nodes
let monitorGain = null;
let delayNode = null;
let feedbackGain = null;
let reverbNode = null;
let isBroadcasterSpeaking = false;


async function fadeTo(target, duration = 600) {
    return new Promise(resolve => {
        const startVol = audio.volume;
        const start = Date.now();
        const it = setInterval(() => {
            const el = Date.now() - start;
            const pr = Math.min(1, el / duration);
            audio.volume = startVol + (target - startVol) * pr;
            if (pr >= 1) { clearInterval(it); resolve(); }
        }, 16);
    });
}

// Helpers
const API_BASE = 'api';

async function checkAuth() {
    try {
        const res = await fetch(`${API_BASE}/auth-check?t=` + Date.now(), { credentials: 'include' });
        const data = await res.json();
        if (!data.authenticated) {
            loginLayer.classList.remove('hidden');
            mainUI.classList.add('hidden');
        } else {
            loginLayer.classList.add('hidden');
            mainUI.classList.remove('hidden');
            loadPlaylist();
            syncState();
            initSocket();
        }
    } catch (e) { loginLayer.classList.remove('hidden'); }
}

async function loadPlaylist() {
    try {
        const res = await fetch(`${API_BASE}/files`, { credentials: 'include' });
        playlist = await res.json();
        renderPlaylist();
    } catch (e) {}
}

async function syncState() {
    try {
        const res = await fetch(`${API_BASE}/sync`, { credentials: 'include' });
        const data = await res.json();
        
        // Update UI based on broadcast state
        if (data.isPlaying) {
            liveIndicator.classList.remove('offline');
            const sourceText = data.source === 'server' ? 'OTOMATİK YAYIN (SUNUCU)' : 'CANLI YAYIN (HOST)';
            liveIndicator.innerText = sourceText;
            streamStartBtn.style.opacity = '0.5';
            streamStartBtn.disabled = true;
            streamStopBtn.disabled = false;
            streamStopBtn.style.opacity = '1';
        } else {
            liveIndicator.classList.add('offline');
            liveIndicator.innerText = 'YAYIN BEKLENİYOR';
            streamStartBtn.style.opacity = '1';
            streamStartBtn.disabled = false;
            streamStopBtn.disabled = true;
            streamStopBtn.style.opacity = '0.5';
        }

        // Handle audio playback sync if a song is specified
        if (data.songName && data.isPlaying) {
            const cleanName = data.songName.split('-').slice(1).join('-').replace(/\.[^/.]+$/, "") || data.songName;
            currentTitle.innerText = cleanName + (data.source === 'server' ? ' [OTOMATİK]' : '');
            currentIndex = playlist.findIndex(f => f.name === data.songName);
            
            // If server is playing, we listen via WebSocket, not direct <iframe> or <audio> src
            // But for the panel to show progress, we might keep it.
            // HOWEVER, if source is 'server', its the same as 'host' speaks - we listen via WS
            if (data.source === 'server') {
                audio.pause();
                audio.src = "";
            } else {
                const streamUrl = `uploads/${encodeURIComponent(data.songName)}`;
                const fullUrl = window.location.origin + '/radyo/' + streamUrl;
                const altUrl = window.location.origin + '/' + streamUrl;
                
                if (audio.src !== fullUrl && audio.src !== altUrl) {
                    audio.src = streamUrl;
                    audio.load();
                }
                if (audio.paused) audio.play().catch(e => {});
            }
            musicPlayBtn.innerHTML = '<i class="fas fa-pause"></i>';
        } else if (!data.songName) {
            if (!data.isPlaying) currentTitle.innerText = "Yayın Bekleniyor...";
            musicPlayBtn.innerHTML = '<i class="fas fa-play"></i>';
        }
    } catch(e) {}
}

if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = e.target.password.value;
        const res = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
            credentials: 'include'
        });
        if ((await res.json()).success) checkAuth(); 
        else document.getElementById('login-error').classList.remove('hidden');
    });
}

function initAudioEngine() {
    if (audioContext) return;
    audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
    
    // Setup Music Layer
    musicSource = audioContext.createMediaElementSource(audio);
    musicGain = audioContext.createGain();
    musicAnalyzer = audioContext.createAnalyser();
    musicAnalyzer.fftSize = 256;
    
    musicGain.gain.value = volMusicFader.value;
    
    musicSource.connect(musicGain);
    musicGain.connect(musicAnalyzer);
    musicAnalyzer.connect(audioContext.destination);

    // Initial Meter Loop
    updateVUMeters();
}

const dataMusic = new Uint8Array(128);
const dataMic = new Uint8Array(128);

function updateVUMeters() {
    if (musicAnalyzer) {
        musicAnalyzer.getByteFrequencyData(dataMusic);
        const avg = dataMusic.reduce((a, b) => a + b) / dataMusic.length;
        if (vuMusicBar) vuMusicBar.style.height = Math.min(100, avg * 1.5) + '%';
    }
    
    if (micAnalyzer && isMicActive) {
        micAnalyzer.getByteFrequencyData(dataMic);
        const avg = dataMic.reduce((a, b) => a + b) / dataMic.length;
        if (vuMicBar) vuMicBar.style.height = Math.min(100, avg * 1.5) + '%';
    } else if (vuMicBar) {
        vuMicBar.style.height = '0%';
    }
    
    requestAnimationFrame(updateVUMeters);
}

const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
    logoutBtn.onclick = async () => {
        await fetch(`${API_BASE}/logout`, { credentials: 'include' });
        location.reload();
    };
}

async function selectIndex(i) {
    currentIndex = i;
    const f = playlist[i];
    const cleanName = f.name.split('-').slice(1).join('-').replace(/\.[^/.]+$/, "") || f.name;
    currentTitle.innerText = cleanName + " (Seçildi)";
    renderPlaylist();
}

async function playIndex(i) {
    if (i < 0) {
        if (playlist.length > 0) i = 0;
        else return;
    }
    initAudioEngine();
    
    // Smooth transition: Fade out current
    if (!audio.paused && audio.src) {
        await fadeTo(0, 800);
    }

    if (i >= playlist.length) {
        if (isLoopEnabled && playlist.length > 0) i = 0;
        else { 
            stopMusic(); 
            return; 
        }
    }
    
    currentIndex = i;
    const f = playlist[i];
    audio.src = `uploads/${encodeURIComponent(f.name)}`;
    audio.load();
    await audio.play();
    
    // Fade in
    audio.volume = 0;
    await fadeTo(volMusicFader.value, 800);
    musicPlayBtn.innerHTML = '<i class="fas fa-pause"></i>';
    
    audio.onended = () => { playIndex(currentIndex + 1); };
    
    // Only send sync if broadcast is active
    const isBroadcasting = !liveIndicator.classList.contains('offline');
    if (isBroadcasting) {
        await fetch(`${API_BASE}/sync`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ songName: f.name, isPlaying: true }),
            credentials: 'include'
        });
    }
    renderPlaylist();
}

async function stopMusic() {
    await fadeTo(0, 600);
    audio.pause();
    audio.src = "";
    audio.volume = volMusicFader.value;
    musicPlayBtn.innerHTML = '<i class="fas fa-play"></i>';
    currentTitle.innerText = currentIndex >= 0 ? "Müzik Durduruldu" : "Yayın Bekleniyor...";
    
    const isBroadcasting = !liveIndicator.classList.contains('offline');
    if (isBroadcasting) {
        await fetch(`${API_BASE}/sync`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ songName: null, isPlaying: true }),
            credentials: 'include'
        });
    }
}

async function stopStream() {
    await stopMusic();
    await fetch(`${API_BASE}/sync`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ isPlaying: false, songName: null }),
        credentials: 'include'
    });
    syncState();
}

musicPlayBtn.addEventListener('click', async () => {
    if (audio.paused || !audio.src) {
        playIndex(currentIndex);
    } else {
        await fadeTo(0, 600);
        audio.pause();
        musicPlayBtn.innerHTML = '<i class="fas fa-play"></i>';
    }
});

musicStopBtn.addEventListener('click', stopMusic);

streamStartBtn.addEventListener('click', async () => {
    initAudioEngine();
    await fetch(`${API_BASE}/sync`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ isPlaying: true, songName: audio.src ? playlist[currentIndex].name : null }),
        credentials: 'include'
    });
    syncState();
});

streamStopBtn.addEventListener('click', stopStream);

loopBtn.addEventListener('click', () => {
    isLoopEnabled = !isLoopEnabled;
    loopBtn.classList.toggle('active', isLoopEnabled);
});

const shuffleBtn = document.getElementById('shuffle-btn-main');
if (shuffleBtn) {
    shuffleBtn.addEventListener('click', async () => {
        if (playlist.length === 0) return;
        let randomIndex = Math.floor(Math.random() * playlist.length);
        // Ensure we don't pick the same song if others are available
        if (playlist.length > 1 && randomIndex === currentIndex) {
            randomIndex = (randomIndex + 1) % playlist.length;
        }
        await playIndex(randomIndex);
    });
}

monitorMuteBtn.addEventListener('click', () => {
    audio.muted = !audio.muted;
    if (listenerGain) {
        listenerGain.gain.setTargetAtTime(audio.muted ? 0 : 1, listenerCtx.currentTime, 0.1);
    }
    monitorMuteBtn.classList.toggle('active', audio.muted);
    monitorMuteBtn.innerHTML = audio.muted ? '<i class="fas fa-volume-mute"></i>' : '<i class="fas fa-volume-up"></i>';
});


// JINGLE SYSTEM (localStorage based)
function loadJingles() {
    ['reklam', 'slogan'].forEach(type => {
        const name = localStorage.getItem(`jingle_${type}_name`);
        if (name) document.getElementById(`name-${type}`).innerText = name;
    });
}

function assignJingle(index, type) {
    const f = playlist[index];
    localStorage.setItem(`jingle_${type}_src`, `uploads/${encodeURIComponent(f.name)}`);
    localStorage.setItem(`jingle_${type}_name`, f.name.split('-').slice(1).join('-').replace(/\.[^/.]+$/, ""));
    loadJingles();
    alert(`${type.toUpperCase()} atandı: ` + f.name);
}

function clearJingle(type) {
    localStorage.removeItem(`jingle_${type}_src`);
    localStorage.removeItem(`jingle_${type}_name`);
    document.getElementById(`name-${type}`).innerText = "Atanmadı";
}

async function playJingle(type) {
    const src = localStorage.getItem(`jingle_${type}_src`);
    if (!src) return alert("Hata: " + type.toUpperCase() + " atanmamış!");
    
    initAudioEngine();
    const originalVol = volMusicFader.value;
    
    await fadeTo(0, 400);
    const oldOnEnded = audio.onended;
    audio.src = src;
    audio.play();
    audio.onended = () => {
        audio.onended = oldOnEnded;
        playIndex(currentIndex); // Resume current
    };
    await fadeTo(originalVol, 400);
}

// WEBSOCKET
function initSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${window.location.host}/radyo/`);
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => socket.send(JSON.stringify({ type: 'listener' }));
    socket.onmessage = (e) => {
        if (isMicActive) return;
        if (e.data instanceof ArrayBuffer) {
            playIncomingAudio(e.data);
        } else {
            try {
                const msg = JSON.parse(e.data);
                if (msg.type === 'mic_state') {
                    isBroadcasterSpeaking = msg.active;
                    applyDucking();
                }
            } catch(err) {}
        }
    };
    socket.onclose = () => setTimeout(initSocket, 3000);
}

function playIncomingAudio(data) {
    try {
        if (!listenerCtx) {
            listenerCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
            listenerGain = listenerCtx.createGain();
            listenerGain.gain.value = audio.muted ? 0 : 1;
            listenerGain.connect(listenerCtx.destination);
        }
        if (listenerCtx.state === 'suspended') listenerCtx.resume();
        const floatData = new Float32Array(data);
        const buffer = listenerCtx.createBuffer(1, floatData.length, 44100);
        buffer.getChannelData(0).set(floatData);
        const source = listenerCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(listenerGain);
        source.start();
    } catch(e) {}
}

function applyDucking() {
    if (!musicGain || !audioContext) return;
    const shouldDuck = isMicActive || isBroadcasterSpeaking;
    const currentFaderVal = parseFloat(volMusicFader.value);
    const targetVal = shouldDuck ? currentFaderVal * 0.15 : currentFaderVal;
    
    // Smooth transition using linearRamp
    musicGain.gain.cancelScheduledValues(audioContext.currentTime);
    musicGain.gain.linearRampToValueAtTime(targetVal, audioContext.currentTime + 0.4);
}

function createImpulseResponse(context, duration, decay) {
    const sampleRate = context.sampleRate;
    const length = sampleRate * duration;
    const impulse = context.createBuffer(2, length, sampleRate);
    for (let i = 0; i < 2; i++) {
        const channelData = impulse.getChannelData(i);
        for (let j = 0; j < length; j++) channelData[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / length, decay);
    }
    return impulse;
}

// TOGGLE MICROPHONE
async function toggleMic() {
    initAudioEngine();
    if (audioContext.state === 'suspended') await audioContext.resume();
    if (listenerCtx && listenerCtx.state === 'suspended') listenerCtx.resume();
    
    isMicActive = !isMicActive;
    micBtn.classList.toggle('active', isMicActive);
    
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'mic_state', active: isMicActive }));
    }

    if (isMicActive) {
        try {
            // Re-ensure context is active
            if (audioContext.state === 'suspended') await audioContext.resume();
            
            micStream = await navigator.mediaDevices.getUserMedia({ 
                audio: { 
                    echoCancellation: true, 
                    noiseSuppression: true,
                    autoGainControl: false
                } 
            });
            
            micSource = audioContext.createMediaStreamSource(micStream);
            micGain = audioContext.createGain();
            micGain.gain.value = volMicFader.value;
            
            micAnalyzer = audioContext.createAnalyser();
            micAnalyzer.fftSize = 256;

            const inputNode = audioContext.createGain();
            micSource.connect(inputNode);

            // Echo
            delayNode = audioContext.createDelay(1.0);
            delayNode.delayTime.value = 0.3;
            feedbackGain = audioContext.createGain();
            feedbackGain.gain.value = 0.4;
            delayNode.connect(feedbackGain);
            feedbackGain.connect(delayNode);
            const echoMix = audioContext.createGain();
            echoMix.gain.value = echoToggle.checked ? 0.5 : 0;
            delayNode.connect(echoMix);

            // Reverb
            reverbNode = audioContext.createConvolver();
            reverbNode.buffer = createImpulseResponse(audioContext, 2.0, 2.0);
            const reverbMix = audioContext.createGain();
            reverbMix.gain.value = reverbToggle.checked ? 0.3 : 0;
            reverbNode.connect(reverbMix);

            const outNode = audioContext.createGain();
            inputNode.connect(outNode);
            echoMix.connect(outNode);
            reverbMix.connect(outNode);

            // Mixer Connection
            outNode.connect(micGain);
            micGain.connect(micAnalyzer);
            
            // Monitor
            monitorGain = audioContext.createGain();
            monitorGain.gain.value = monToggle.checked ? 1.0 : 0;
            micGain.connect(monitorGain);
            monitorGain.connect(audioContext.destination);

            // Stream Processor
            micProcessor = audioContext.createScriptProcessor(4096, 1, 1);
            micGain.connect(micProcessor);
            const silencer = audioContext.createGain(); silencer.gain.value = 0;
            micProcessor.connect(silencer); silencer.connect(audioContext.destination);
            
            micProcessor.onaudioprocess = (e) => {
                if (socket && socket.readyState === WebSocket.OPEN && isMicActive) {
                    socket.send(new Float32Array(e.inputBuffer.getChannelData(0)).buffer);
                }
            };

            // Updates for live toggles
            monToggle.onchange = () => { if (monitorGain) monitorGain.gain.value = monToggle.checked ? 1.0 : 0; };
            echoToggle.onchange = () => { 
                if (echoMix) echoMix.gain.value = echoToggle.checked ? 0.5 : 0; 
                echoBadge.classList.toggle('active', echoToggle.checked);
                echoBadge.innerText = `ECHO: ${echoToggle.checked ? 'ON' : 'OFF'}`;
            };
            reverbToggle.onchange = () => { 
                if (reverbMix) reverbMix.gain.value = reverbToggle.checked ? 0.3 : 0; 
                reverbBadge.classList.toggle('active', reverbToggle.checked);
                reverbBadge.innerText = `REVERB: ${reverbToggle.checked ? 'ON' : 'OFF'}`;
            };

        } catch(e) { 
            isMicActive = false; micBtn.classList.remove('active'); alert('Mikrofon hatası: ' + e); 
        }
    } else {
        cleanupMic();
    }
    applyDucking();
}

function cleanupMic() {
    if (micStream) micStream.getTracks().forEach(t => t.stop());
    if (micProcessor) { micProcessor.disconnect(); micProcessor.onaudioprocess = null; }
    if (monitorGain) monitorGain.disconnect();
    micStream = null;
}

micBtn.addEventListener('click', toggleMic);
window.addEventListener('keydown', (e) => {
    if (e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); toggleMic(); }
});

// FADER HANDLERS
volMusicFader.addEventListener('input', (e) => {
    if (musicGain) musicGain.gain.setTargetAtTime(e.target.value, audioContext.currentTime, 0.05);
    applyDucking();
});

volMicFader.addEventListener('input', (e) => {
    if (micGain) micGain.gain.setTargetAtTime(e.target.value, audioContext.currentTime, 0.05);
});

// UTILS
function fadeTo(targetVol, duration) {
    return new Promise(resolve => {
        const startVol = audio.volume;
        const startTime = performance.now();
        
        function update() {
            const elapsed = performance.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            audio.volume = startVol + (targetVol - startVol) * progress;
            
            if (progress < 1) requestAnimationFrame(update);
            else resolve();
        }
        requestAnimationFrame(update);
    });
}

const renderPlaylist = () => {
    loadJingles();
    playlistEl.innerHTML = '';
    playlist.forEach((f, i) => {
        const div = document.createElement('div');
        div.className = 'song-row' + (currentIndex === i ? ' active' : '');
        
        // Handle names with and without dash prefix
        const nameParts = f.name.split('-');
        let displayName = "";
        if (nameParts.length > 1) {
            displayName = nameParts.slice(1).join('-').replace(/\.[^/.]+$/, "");
        } else {
            displayName = f.name.replace(/\.[^/.]+$/, "");
        }
        
        div.innerHTML = `
            <span class="song-index">${i+1}</span>
            <div class="song-meta" onclick="selectIndex(${i})">
                <h4>${displayName}</h4>
            </div>
            <div class="song-ops">
                <button class="op-btn" onclick="playIndex(${i})" style="color:var(--success)"><i class="fas fa-play"></i></button>
                <button class="op-btn" onclick="assignJingle(${i}, 'reklam')" title="Reklam Olarak Ata"><i class="fas fa-ad"></i></button><button class="op-btn" onclick="assignJingle(${i}, 'slogan')" title="Slogan Olarak Ata"><i class="fas fa-microphone-alt"></i></button><button class="op-btn" onclick="renameItem(${i})"><i class="fas fa-edit"></i></button>
                <button class="op-btn" onclick="move(${i}, -1)"><i class="fas fa-chevron-up"></i></button>
                <button class="op-btn" onclick="move(${i}, 1)"><i class="fas fa-chevron-down"></i></button>
                <button class="op-btn" onclick="del(${i})" style="color:var(--danger)"><i class="fas fa-trash-alt"></i></button>
            </div>
        `;
        playlistEl.appendChild(div);
    });
};

async function move(i, d) {
    const ni = i + d; if (ni < 0 || ni >= playlist.length) return;
    [playlist[i], playlist[ni]] = [playlist[ni], playlist[i]];
    renderPlaylist();
    await fetch(`${API_BASE}/order`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ order: playlist.map(x => x.name) }),
        credentials: 'include'
    });
}

async function del(i) {
    if (confirm('Silmek emin misiniz?')) {
        await fetch(`${API_BASE}/files/${encodeURIComponent(playlist[i].name)}`, { 
            method: 'DELETE',
            credentials: 'include'
        });
        loadPlaylist();
    }
}

async function renameItem(i) {
    const oldName = playlist[i].name;
    const currentBase = oldName.split('-').slice(1).join('-').replace(/\.[^/.]+$/, "");
    const newBase = prompt('Yeni şarkı adını girin:', currentBase);
    if (newBase && newBase !== currentBase) {
        await fetch(`${API_BASE}/rename`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oldName, newName: oldName.split('-')[0] + '-' + newBase }),
            credentials: 'include'
        });
        loadPlaylist();
    }
}

document.getElementById('shuffle-btn').addEventListener('click', async () => {
    if (playlist.length < 2) return;
    for (let i = playlist.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [playlist[i], playlist[j]] = [playlist[j], playlist[i]];
    }
    renderPlaylist();
    await fetch(`${API_BASE}/order`, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ order: playlist.map(x => x.name) }),
        credentials: 'include'
    });
});

function showTab(tabId) {
    document.querySelectorAll('.nav-btn').forEach(b => {
        if (b.dataset.tab === tabId) b.classList.add('active'); else b.classList.remove('active');
    });
    document.querySelectorAll('.pane').forEach(p => p.classList.add('hidden'));
    document.getElementById(`${tabId}-tab`).classList.remove('hidden');
}

document.querySelectorAll('.nav-btn[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
})
const fileIn = document.getElementById('audio-input');
const uploadZone = document.getElementById('upload-zone');

async function handleFiles(files) {
    if (!uploadZone) return;
    uploadZone.innerHTML = '<i class="fas fa-spinner fa-spin"></i><p>Yükleniyor...</p>';
    try {
        for (const file of files) {
            const fd = new FormData();
            fd.append('audio', file);
            await fetch(`${API_BASE}/upload`, { 
                method: 'POST', 
                body: fd,
                credentials: 'include'
            });
        }
        uploadZone.innerHTML = '<i class="fas fa-check-circle" style="color:var(--success)"></i><p>Tamamlandı!</p>';
        setTimeout(() => {
            uploadZone.innerHTML = '<i class="fas fa-file-audio"></i><p>Dosyaları buraya bırakın veya tıklayın</p>';
            loadPlaylist();
            setTimeout(loadPlaylist, 1000); // Double-ensure sync after 1s
        }, 1200);
    } catch(e) { 
        alert('Yükleme hatası!'); 
        uploadZone.innerHTML = '<i class="fas fa-file-audio"></i><p>Dosyaları buraya bırakın veya tıklayın</p>';
    }
}

if (uploadZone) {
    uploadZone.addEventListener('click', () => fileIn.click());
    fileIn.addEventListener('change', () => handleFiles(fileIn.files));

    // Drag & Drop
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
        uploadZone.addEventListener(evt, (e) => {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });

    ['dragenter', 'dragover'].forEach(evt => {
        uploadZone.addEventListener(evt, () => uploadZone.classList.add('drag-active'), false);
    });

    ['dragleave', 'drop'].forEach(evt => {
        uploadZone.addEventListener(evt, () => uploadZone.classList.remove('drag-active'), false);
    });

    uploadZone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        handleFiles(dt.files);
    }, false);
}

checkAuth();
setInterval(syncState, 5000);
