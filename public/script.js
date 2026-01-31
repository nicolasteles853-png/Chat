const socket = io();
let username = "";

// ELEMENTOS
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

// TYPING INDICATOR
let typingTimeout;
const typingDiv = document.createElement('div');
typingDiv.id = "typing-indicator";
typingDiv.style.fontStyle = "italic";
typingDiv.style.color = "#ccc";
typingDiv.style.margin = "5px 0";
messagesDiv.appendChild(typingDiv);

// Usuários que estão transmitindo vídeo
let activeVideoUsers = new Set();
let typingUsers = new Set();
let localStream;
let peers = {}; // RTCPeerConnections por usuário
let isStreaming = false;

// -----------------------
// LOGIN
// -----------------------
loginBtn.addEventListener("click", () => {
    if(loginUsername.value.trim() !== "") {
        username = loginUsername.value.trim();
        userDisplay.textContent = username;

        loginContainer.style.display = "none";
        chatContainer.style.display = "flex";
    }
});

// -----------------------
// MENSAGENS
// -----------------------
function addMessage(line, sender) {
    const div = document.createElement('div');
    div.classList.add('message');
    div.classList.add(sender === username ? 'self' : 'other');

    // Adiciona ícone de câmera se o usuário estiver transmitindo
    if(activeVideoUsers.has(sender)) {
        line = "📹 " + line;
    }

    div.innerHTML = line;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    updateTypingIndicator();
}

// Atualiza box de typing
function updateTypingIndicator() {
    if(typingUsers.size === 0) {
        typingDiv.textContent = "";
        typingDiv.style.display = "none";
    } else {
        typingDiv.style.display = "block";
        const users = Array.from(typingUsers).filter(u => u !== username);
        if(users.length > 0) {
            typingDiv.textContent = users.join(', ') + (users.length === 1 ? " está digitando..." : " estão digitando...") + " ( • • • )";
        } else {
            typingDiv.textContent = "";
        }
    }
}

// Recebe histórico
socket.on('chat history', (lines) => {
    messagesDiv.innerHTML = "";
    messagesDiv.appendChild(typingDiv);
    lines.forEach(line => {
        const senderMatch = line.match(/<strong>(.*?)<\/strong>/);
        const sender = senderMatch ? senderMatch[1] : '';
        addMessage(line, sender);
    });
});

// Recebe nova mensagem
socket.on('chat message', (line) => {
    const senderMatch = line.match(/<strong>(.*?)<\/strong>/);
    const sender = senderMatch ? senderMatch[1] : '';
    addMessage(line, sender);
    if(sender !== username) {
        typingUsers.delete(sender);
        updateTypingIndicator();
    }
});

// -----------------------
// ENVIAR TEXTO
// -----------------------
sendMessageBtn.addEventListener("click", sendMessage);
messageInput.addEventListener("keypress", e => {
    if(e.key === "Enter") sendMessage();

    // Emit typing
    socket.emit("typing", username);
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit("stop-typing", username);
    }, 1000);
});

function sendMessage() {
    if(messageInput.value.trim() === "") return;
    socket.emit('new message', { username, message: messageInput.value.trim() });
    messageInput.value = "";
    socket.emit("stop-typing", username);
}

// -----------------------
// ENVIAR IMAGEM
// -----------------------
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

// -----------------------
// GRAVAR ÁUDIO
// -----------------------
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
            })
            .catch(err => alert("Erro ao acessar microfone: " + err));
    } else if(mediaRecorder.state === "recording") {
        mediaRecorder.stop();
        recordAudioBtn.textContent = "🎤 Gravar Áudio";
    }
});

// -----------------------
// VIDEOCHAT COM WEbrtc
// -----------------------
cameraBtn.addEventListener("click", async () => {
    if(!isStreaming) {
        // INICIAR TRANSMISSÃO
        if(videoContainer.style.display === "none") videoContainer.style.display = "flex";

        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;

        socket.emit("join-video", username);
        cameraBtn.textContent = "⛔";
        isStreaming = true;

        // Informar os outros usuários que está transmitindo
        activeVideoUsers.add(username);
        socket.emit("video-active", username);

        // Criar conexões para usuários que já estão transmitindo
        socket.on('active-video-users', (users) => {
            users.forEach(user => {
                if(user !== username) {
                    createPeerConnection(user);
                }
            });
        });

    } else {
        // PARAR TRANSMISSÃO
        if(localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localVideo.srcObject = null;
        }
        for(let peerId in peers) {
            peers[peerId].close();
        }
        peers = {};
        cameraBtn.textContent = "📷";
        isStreaming = false;

        activeVideoUsers.delete(username);
        socket.emit("video-inactive", username);
    }
});

// -----------------------
// CRIA PEER CONNECTION
// -----------------------
async function createPeerConnection(peerId) {
    if(peers[peerId]) return;

    const pc = new RTCPeerConnection();
    peers[peerId] = pc;

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.ontrack = e => {
        let remoteVideo = document.getElementById("remote-"+peerId);
        if(!remoteVideo) {
            remoteVideo = document.createElement("video");
            remoteVideo.id = "remote-"+peerId;
            remoteVideo.autoplay = true;
            remoteVideo.playsInline = true;
            remoteVideos.appendChild(remoteVideo);
        }
        remoteVideo.srcObject = e.streams[0];
    };

    pc.onicecandidate = e => {
        if(e.candidate) socket.emit("ice-candidate", { to: peerId, candidate: e.candidate });
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("offer", { to: peerId, from: username, offer });
}

// -----------------------
// INDICADOR DE VÍDEO ATIVO
// -----------------------
socket.on("video-active", async (user) => {
    activeVideoUsers.add(user);
    if(isStreaming) createPeerConnection(user);
});

socket.on("video-inactive", (user) => {
    activeVideoUsers.delete(user);
    if(peers[user]) {
        peers[user].close();
        delete peers[user];
        const vid = document.getElementById("remote-" + user);
        if(vid) vid.remove();
    }
});

// -----------------------
// TYPING INDICATOR
// -----------------------
socket.on("typing", (user) => {
    if(user !== username) {
        typingUsers.add(user);
        updateTypingIndicator();
    }
});

socket.on("stop-typing", (user) => {
    if(user !== username) {
        typingUsers.delete(user);
        updateTypingIndicator();
    }
});

// -----------------------
// WEBRTC (offer/answer/candidate)
socket.on("new-peer", async (peerId) => {
    if(peerId === username || !isStreaming) return;
    createPeerConnection(peerId);
});

socket.on("offer", async ({ from, offer }) => {
    const pc = new RTCPeerConnection();
    peers[from] = pc;

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.ontrack = e => {
        let remoteVideo = document.getElementById("remote-"+from);
        if(!remoteVideo) {
            remoteVideo = document.createElement("video");
            remoteVideo.id = "remote-"+from;
            remoteVideo.autoplay = true;
            remoteVideo.playsInline = true;
            remoteVideos.appendChild(remoteVideo);
        }
        remoteVideo.srcObject = e.streams[0];
    };

    pc.onicecandidate = e => {
        if(e.candidate) socket.emit("ice-candidate", { to: from, candidate: e.candidate });
    };

    await pc.setRemoteDescription(offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("answer", { to: from, answer });
});

socket.on("answer", async ({ from, answer }) => {
    if(peers[from]) await peers[from].setRemoteDescription(answer);
});

socket.on("ice-candidate", async ({ from, candidate }) => {
    if(peers[from]) {
        await peers[from].addIceCandidate(candidate);
    }
});

// -----------------------
// RECEBE LISTA DE USUÁRIOS QUE JÁ ESTÃO TRANSMITINDO
socket.on('active-video-users', (users) => {
    users.forEach(user => activeVideoUsers.add(user));
});
