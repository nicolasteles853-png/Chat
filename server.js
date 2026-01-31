const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const messagesFile = path.join(__dirname, 'messages.txt');

app.use(express.static('public'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

function loadMessages() {
    if(fs.existsSync(messagesFile)) {
        return fs.readFileSync(messagesFile, 'utf8')
                 .split("\n")
                 .filter(line => line.trim() !== "");
    }
    return [];
}

function saveMessage(line) {
    fs.appendFileSync(messagesFile, line + "\n");
}

io.on('connection', (socket) => {
    console.log('Novo usuário conectado');

    socket.emit('chat history', loadMessages());

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
    socket.on('join-video', (username) => {
        socket.broadcast.emit('new-peer', username);
    });

    socket.on('offer', ({ to, from, offer }) => {
        io.emit('offer', { to, from, offer }); // enviar para todos
    });

    socket.on('answer', ({ to, from, answer }) => {
        io.emit('answer', { to, from, answer });
    });

    socket.on('ice-candidate', ({ to, from, candidate }) => {
        io.emit('ice-candidate', { to, from, candidate });
    });

    socket.on('video-active', (username) => {
        socket.broadcast.emit('video-active', username);
    });

    socket.on('video-inactive', (username) => {
        socket.broadcast.emit('video-inactive', username);
    });

    socket.on('typing', (username) => {
        socket.broadcast.emit('typing', username);
    });

    socket.on('stop-typing', (username) => {
        socket.broadcast.emit('stop-typing', username);
    });
});

server.listen(PORT, () => console.log(`Servidor rodando em http://localhost:${PORT}`));
