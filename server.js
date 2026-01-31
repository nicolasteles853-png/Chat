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
    if (fs.existsSync(messagesFile)) {
        return fs.readFileSync(messagesFile, 'utf8')
            .split("\n")
            .filter(l => l.trim() !== "");
    }
    return [];
}

function saveMessage(line) {
    fs.appendFileSync(messagesFile, line + "\n");
}

io.on('connection', (socket) => {
    console.log('Usuário conectado:', socket.id);

    // Envia histórico de chat
    socket.emit('chat history', loadMessages());

    // NOVA MENSAGEM
    socket.on('new message', (data) => {
        const { username, message, image, audio } = data;
        let line = `<strong>${username}:</strong> ${message || ''}`;
        if (image) line += `<br><img src="${image}" style="max-width:200px;border-radius:10px;">`;
        if (audio) line += `<br><audio controls src="${audio}"></audio>`;
        saveMessage(line);
        io.emit('chat message', line);
    });

    // ---------- VÍDEO GLOBAL ----------
    socket.on('start-video', (username) => {
        socket.broadcast.emit('user-started-video', { socketId: socket.id, username });
    });

    socket.on('stop-video', () => {
        socket.broadcast.emit('user-stopped-video', socket.id);
    });

    socket.on('offer', (data) => {
        io.to(data.to).emit('offer', data);
    });

    socket.on('answer', (data) => {
        io.to(data.to).emit('answer', data);
    });

    socket.on('ice-candidate', (data) => {
        io.to(data.to).emit('ice-candidate', data);
    });

    // ---------- TYPING ----------
    socket.on('typing', (username) => socket.broadcast.emit('typing', username));
    socket.on('stop-typing', (username) => socket.broadcast.emit('stop-typing', username));

    // ---------- DESCONEXÃO ----------
    socket.on('disconnect', () => {
        socket.broadcast.emit('user-stopped-video', socket.id);
    });
});

server.listen(PORT, () => console.log('Servidor rodando na porta', PORT));
