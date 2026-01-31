const socket = io();
let username = "";

const loginContainer = document.getElementById("login-container");
const chatContainer = document.getElementById("chat-container");
const loginBtn = document.getElementById("login-btn");
const loginUsername = document.getElementById("login-username");
const userDisplay = document.getElementById("user-display");
const messageInput = document.getElementById("message");
const messagesDiv = document.getElementById("messages");
const sendMessageBtn = document.getElementById("send-message");
const sendImageInput = document.getElementById("send-image");
const recordAudioBtn = document.getElementById("record-audio");
const cameraBtn = document.getElementById("camera-btn");

const videoContainer = document.getElementById("video-container");
const localVideo = document.getElementById("local-video");
const remoteVideos = document.getElementById("remote-videos");

let typingTimeout;
const typingDiv = document.createElement('div');
typingDiv.id = "typing-indicator";
typingDiv.style.fontStyle = "italic";
typingDiv.style.color = "#ccc";
typingDiv.style.margin = "5px 0";
messagesDiv.appendChild(typingDiv);

let activeVideoUsers = new Set();
let typingUsers = new Set();

loginBtn.addEventListener("click", () => {
    if(loginUsername.value.trim() !== "") {
        username = loginUsername.value.trim();
        userDisplay.textContent = username;

        loginContainer.style.display = "none";
        chatContainer.style.display = "flex";
    }
});

function addMessage(line, sender) {
    const div = document.createElement('div');
    div.classList.add('message');
    div.classList.add(sender === username ? 'self' : 'other');

    if(activeVideoUsers.has(sender)) line = "📹 " + line;

    div.innerHTML = line;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    updateTypingIndicator();
}

function updateTypingIndicator() {
    if(typingUsers.size === 0) {
        typingDiv.textContent = "";
        typingDiv.style.display = "none";
    } else {
        typingDiv.style.display = "block";
        const users = Array.from(typingUsers).filter(u => u !== username);
        if(users.length > 0) {
            typingDiv.textContent = users.join(', ') + (users.length === 1 ? " está digitando..." : " estão digitando...") + " ( • • • )";
        } else typingDiv.textContent = "";
    }
}

socket.on('chat history', (lines) => {
    messagesDiv.innerHTML = "";
    messagesDiv.appendChild(typingDiv);
    lines.forEach(line => {
        const senderMatch = line.match(/<strong>(.*?)<\/strong>/);
        const sender = senderMatch ? senderMatch[1] : '';
        addMessage(line, sender);
    });
});

socket.on('chat message', (line) => {
    const senderMatch = line.match(/<strong>(.*?)<\/strong>/);
    const sender = senderMatch ? senderMatch[1] : '';
    addMessage(line, sender);
    if(sender !== username) {
        typingUsers.delete(sender);
        updateTypingIndicator();
    }
});

sendMessageBtn.addEventListener("click", sendMessage);
messageInput.addEventListener("keypress", e => {
    if(e.key === "Enter") sendMessage();
    socket.emit("typing", username);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => socket.emit("stop-typing", username), 1000);
});

function sendMessage() {
    if(messageInput.value.trim() === "") return;
    socket.emit('new message', { username, message: messageInput.value.trim() });
    messageInput.value = "";
    socket.emit("stop-typing", username);
}

sendImageInput.addEventListener("change", function() {
    const file = this.files[0];
    if(file) {
        const reader = new FileReader();
        reader.onload = () => {
            socket.emit('new message', { username, message: "[Imagem]", image: reader.result });
            sendImageInput.value = "";
        }
        reader.readAsDataURL(file);
    }
});

let mediaRecorder;
let audioChunks = [];
recordAudioBtn.addEventListener("click", () => {
    if(!mediaRecorder || mediaRecorder.state === "inactive") {
        navigator.mediaDevices.getUserMedia({ audio: true })
            .then(stream => {
                mediaRecorder = new MediaRecorder(stream);
                audioChunks = [];
                mediaRecorder.ondataavailable = e => { audioChunks.push(e.data); };
                mediaRecorder.onstop = () => {
                    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                    const reader = new FileReader();
                    reader.onload = () => {
                        socket.emit('new message', { username, message: "[Áudio Gravado]", audio: reader.result });
                    };
                    reader.readAsDataURL(audioBlob);
                };
                mediaRecorder.start();
                recordAudioBtn.textContent = "🛑 Parar Gravação";
            }).catch(err => alert("Erro ao acessar microfone: " + err));
    } else if(mediaRecorder.state === "recording") {
        mediaRecorder.stop();
        recordAudioBtn.textContent = "🎤 Gravar Áudio";
    }
});

// -----------------------
// VIDEOCHAT MULTI-STREAM
// -----------------------
let localStream;
let peers = {};
let isStreaming = false;

cameraBtn.addEventListener("click", async () => {
    if(!isStreaming) {
        if(videoContainer.style.display === "none") videoContainer.style.display = "flex";
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;

        socket.emit("join-video", username);
        cameraBtn.textContent = "⛔";
        isStreaming = true;

        activeVideoUsers.add(username);
        socket.emit("video-active", username);
    } else {
        if(localStream) localStream.getTracks().forEach(track => track.stop());
        localVideo.srcObject = null;
        for(let p in peers) peers[p].close();
        peers = {};
        cameraBtn.textContent = "📷";
        isStreaming = false;

        activeVideoUsers.delete(username);
        socket.emit("video-inactive", username);
    }
});

socket.on("video-active", user => activeVideoUsers.add(user));
socket.on("video-inactive", user => activeVideoUsers.delete(user));

socket.on("typing", u => { if(u !== username){ typingUsers.add(u); updateTypingIndicator(); } });
socket.on("stop-typing", u => { if(u !== username){ typingUsers.delete(u); updateTypingIndicator(); } });

socket.on("new-peer", async peerId => {
    if(peerId === username) return;
    const pc = new RTCPeerConnection();
    peers[peerId] = pc;
    if(localStream) localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    pc.ontrack = e => addRemoteVideo(peerId, e.streams[0]);
    pc.onicecandidate = e => { if(e.candidate) socket.emit("ice-candidate", { to: peerId, from: username, candidate: e.candidate }); };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("offer", { to: peerId, from: username, offer });
});

socket.on("offer", async ({ to, from, offer }) => {
    if(to !== username) return;
    const pc = new RTCPeerConnection();
    peers[from] = pc;
    if(localStream) localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    pc.ontrack = e => addRemoteVideo(from, e.streams[0]);
    pc.onicecandidate = e => { if(e.candidate) socket.emit("ice-candidate", { to: from, from: username, candidate: e.candidate }); };
    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("answer", { to: from, from: username, answer });
});

socket.on("answer", async ({ to, from, answer }) => { if(to === username && peers[from]) await peers[from].setRemoteDescription(answer); });
socket.on("ice-candidate", async ({ to, from, candidate }) => { if(to === username && peers[from]) await peers[from].addIceCandidate(candidate); });

function addRemoteVideo(peerId, stream) {
    let video = document.getElementById("remote-" + peerId);
    if(!video) {
        video = document.createElement("video");
        video.id = "remote-" + peerId;
        video.autoplay = true;
        video.playsInline = true;
        video.controls = true;
        remoteVideos.appendChild(video);
    }
    video.srcObject = stream;
}
