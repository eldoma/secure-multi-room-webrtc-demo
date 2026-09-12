const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

app.get("/", (req, res) => {
  res.send("WebRTC signaling server is running");
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "webrtc-signaling-server",
  });
});

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("join-room", (roomId) => {
    if (!roomId) {
      return;
    }

    socket.join(roomId);
    socket.data.roomId = roomId;

    console.log(`Socket ${socket.id} joined room ${roomId}`);

    // Notify existing users in the room that a new peer joined.
    socket.to(roomId).emit("peer-joined", {
      peerId: socket.id,
    });

    // Tell the joining client who is already in the room.
    const room = io.sockets.adapter.rooms.get(roomId);

    const peers = room
      ? [...room].filter((peerId) => peerId !== socket.id)
      : [];

    socket.emit("room-joined", {
      roomId,
      socketId: socket.id,
      peers,
    });
  });

  socket.on("leave-room", () => {
    const roomId = socket.data.roomId;

    if (!roomId) {
      return;
    }

    socket.leave(roomId);

    socket.to(roomId).emit("peer-left", {
      peerId: socket.id,
    });

    console.log(`Socket ${socket.id} left room ${roomId}`);

    socket.data.roomId = null;
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;

    if (roomId) {
      socket.to(roomId).emit("peer-left", {
        peerId: socket.id,
      });
    }

    console.log("Client disconnected:", socket.id);
  });
});

const PORT = 3000;

server.listen(PORT, () => {
  console.log(`Signaling server running on http://localhost:${PORT}`);
});