(function() {
    let audioContext = null;
    let listenerCtx = null;
    let listenerGain = null;
    let socket = null;
    let nextStartTime = 0;
    const BUFFER_OFFSET = 0.1; // 100ms for extra safety on main site

    function initAudio() {
        if (listenerCtx) return;
        listenerCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
        listenerGain = listenerCtx.createGain();
        listenerGain.connect(listenerCtx.destination);
        nextStartTime = listenerCtx.currentTime + BUFFER_OFFSET;
    }

    function initSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        // Connect to the radio server (proxied at /radyo/)
        const wsUrl = protocol + '//' + window.location.host + '/radyo/ws';
        
        socket = new WebSocket(wsUrl);
        socket.binaryType = 'arraybuffer';
        
        socket.onmessage = (e) => {
            if (typeof e.data === 'string') {
                const data = JSON.parse(e.data);
                if (data.type === 'status') {
                    // Update UI if needed
                    const songDisplay = document.querySelector('.radio-song-name');
                    if (songDisplay && data.songName) {
                        songDisplay.innerText = data.songName;
                    }
                }
                return;
            }
            // Binary PCM data
            playAudio(e.data);
        };
        
        socket.onclose = () => setTimeout(initSocket, 3000);
    }

    function playAudio(data) {
        if (!listenerCtx) return;
        try {
            if (listenerCtx.state === 'suspended') listenerCtx.resume();
            
            const floatData = new Float32Array(data);
            const buffer = listenerCtx.createBuffer(1, floatData.length, 44100);
            buffer.getChannelData(0).set(floatData);
            
            const source = listenerCtx.createBufferSource();
            source.buffer = buffer;
            source.connect(listenerGain);
            
            if (nextStartTime < listenerCtx.currentTime) {
                nextStartTime = listenerCtx.currentTime + 0.05;
            }
            
            source.start(nextStartTime);
            nextStartTime += buffer.duration;
        } catch(e) {}
    }

    // Export controls
    window.GaddarRadyo = {
        start: () => {
            initAudio();
            if (!socket) initSocket();
            if (listenerGain) listenerGain.gain.setTargetAtTime(1, listenerCtx.currentTime, 0.1);
        },
        stop: () => {
            if (listenerGain) listenerGain.gain.setTargetAtTime(0, listenerCtx.currentTime, 0.1);
        },
        setVolume: (v) => {
            if (listenerGain) listenerGain.gain.setTargetAtTime(v, listenerCtx.currentTime, 0.1);
        }
    };

    console.log("Gaddar Radyo Bridge Loaded. Call window.GaddarRadyo.start() to play.");
})();
