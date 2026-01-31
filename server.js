const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;
const messagesFile = path.join(__dirname, 'messages.txt');

// Servir arquivos estáticos
app.use(express.static('public'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Carregar mensagens do arquivo
function loadMessages() {
    if(fs.existsSync(messagesFile)) {
        return fs.readFileSync(messagesFile, 'utf8')
                 .split("\n")
                 .filter(line => line.trim() !== "");
    }
    return [];
}

// Salvar nova mensagem no arquivo
function saveMessage(line) {
    fs.appendFileSync(messagesFile, line + "\n");
}

// Conexão Socket.IO
io.on('connection', (socket) => {
    console.log('Novo usuário conectado');

    // Envia histórico para o usuário que entrou
    socket.emit('chat history', loadMessages());

    // NOVA MENSAGEM
    socket.on('new message', (data) => {
        const { username, message, image, audio } = data;
        let line = `<strong>${username}:</strong> ${message || ''}`;

        if(image) line += `<br><img src='${image}' style='max-width:200px; border-radius:10px;'>`;
        if(audio) line += `<br><audio controls src='${audio}'></audio>`;

        saveMessage(line);
        io.emit('chat message', line);
    });

    // -----------------------
    // VIDEOCHAT (WebRTC)
    // -----------------------

    // Usuário entrou na chamada de vídeo
    socket.on('join-video', (username) => {
        socket.broadcast.emit('new-peer', username);
    });

    // Envia offer para outro usuário
    socket.on('offer', ({ to, from, offer }) => {
        socket.broadcast.emit('offer', { from, offer });
    });

    // Envia answer para o remetente da offer
    socket.on('answer', ({ to, answer }) => {
        socket.broadcast.emit('answer', { from: to, answer });
    });

    // Envia ICE candidates para outro usuário
    socket.on('ice-candidate', ({ to, candidate }) => {
        socket.broadcast.emit('ice-candidate', { from: to, candidate });
    });

    // -----------------------
    // INDICADOR DE VÍDEO ATIVO
    // -----------------------
    socket.on('video-active', (username) => {
        socket.broadcast.emit('video-active', username);
    });

    socket.on('video-inactive', (username) => {
        socket.broadcast.emit('video-inactive', username);
    });
});

// Iniciar servidor
server.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
