const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
const { Server } = require("socket.io");

const app = express();

const PORT = process.env.PORT || 3000;

const CLIENT_ORIGIN =
  process.env.CLIENT_ORIGIN || "http://localhost:5173";

app.use(
  cors({
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"],
  })
);

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"],
  },
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "webrtc-signaling-server",
    environment: process.env.NODE_ENV || "development",
    timestamp: new Date().toISOString(),
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

    socket.to(roomId).emit("peer-joined", {
      peerId: socket.id,
    });

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

  socket.on("webrtc-offer", ({ target, offer }) => {
    io.to(target).emit("webrtc-offer", {
      from: socket.id,
      offer,
    });
  });

  socket.on("webrtc-answer", ({ target, answer }) => {
    io.to(target).emit("webrtc-answer", {
      from: socket.id,
      answer,
    });
  });

  socket.on(
    "webrtc-ice-candidate",
    ({ target, candidate }) => {
      io.to(target).emit("webrtc-ice-candidate", {
        from: socket.id,
        candidate,
      });
    }
  );

  socket.on("leave-room", () => {
    const roomId = socket.data.roomId;

    if (!roomId) {
      return;
    }

    socket.leave(roomId);

    socket.to(roomId).emit("peer-left", {
      peerId: socket.id,
    });

    console.log(
      `Socket ${socket.id} left room ${roomId}`
    );

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

/*
 * Production React build
 *
 * Expected structure:
 *
 * Secure-WebRTC-Demo/
 * ├── client/
 * │   └── dist/
 * └── server/
 *     └── server.js
 */
const clientDistPath = path.join(
  __dirname,
  "..",
  "client",
  "dist"
);

if (process.env.NODE_ENV === "production") {
  app.use(express.static(clientDistPath));

  // SPA fallback for Express 5.
  app.use((req, res) => {
    res.sendFile(
      path.join(clientDistPath, "index.html")
    );
  });
} else {
  app.get("/", (req, res) => {
    res.send(
      "WebRTC signaling server is running"
    );
  });
}

server.listen(PORT, () => {
  console.log(
    `WebRTC server running on port ${PORT}`
  );

  console.log(
    `Environment: ${
      process.env.NODE_ENV || "development"
    }`
  );

  console.log(
    `Allowed client origin: ${CLIENT_ORIGIN}`
  );
});