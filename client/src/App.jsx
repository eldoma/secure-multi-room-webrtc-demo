import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

function App() {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [socketId, setSocketId] = useState("");

  const [roomId, setRoomId] = useState("");
  const [joinedRoom, setJoinedRoom] = useState("");
  const [peers, setPeers] = useState([]);

  const [mediaReady, setMediaReady] = useState(false);
  const [mediaError, setMediaError] = useState("");

  const localVideoRef = useRef(null);
  const localStreamRef = useRef(null);

  useEffect(() => {
    const newSocket = io("http://localhost:3000");

    setSocket(newSocket);

    newSocket.on("connect", () => {
      console.log("Connected:", newSocket.id);
      setConnected(true);
      setSocketId(newSocket.id);
    });

    newSocket.on("disconnect", () => {
      setConnected(false);
      setSocketId("");
      setJoinedRoom("");
      setPeers([]);
    });

    newSocket.on("room-joined", ({ roomId, peers }) => {
      console.log("Joined room:", roomId);
      console.log("Existing peers:", peers);

      setJoinedRoom(roomId);
      setPeers(peers);
    });

    newSocket.on("peer-joined", ({ peerId }) => {
      console.log("Peer joined:", peerId);

      setPeers((currentPeers) => {
        if (currentPeers.includes(peerId)) {
          return currentPeers;
        }

        return [...currentPeers, peerId];
      });
    });

    newSocket.on("peer-left", ({ peerId }) => {
      console.log("Peer left:", peerId);

      setPeers((currentPeers) =>
        currentPeers.filter((id) => id !== peerId)
      );
    });

    return () => {
      newSocket.disconnect();

      if (localStreamRef.current) {
        localStreamRef.current
          .getTracks()
          .forEach((track) => track.stop());
      }
    };
  }, []);

  const startMedia = async () => {
    try {
      setMediaError("");

      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });

      localStreamRef.current = stream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      setMediaReady(true);
    } catch (error) {
      console.error("Media access failed:", error);

      setMediaError(
        "Could not access camera or microphone. Check browser permissions."
      );
    }
  };

  const stopMedia = () => {
    if (localStreamRef.current) {
      localStreamRef.current
        .getTracks()
        .forEach((track) => track.stop());

      localStreamRef.current = null;
    }

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }

    setMediaReady(false);
  };

  const joinRoom = () => {
    const trimmedRoomId = roomId.trim();

    if (!socket || !connected || !trimmedRoomId) {
      return;
    }

    socket.emit("join-room", trimmedRoomId);
  };

  const leaveRoom = () => {
    if (!socket || !joinedRoom) {
      return;
    }

    socket.emit("leave-room");

    setJoinedRoom("");
    setPeers([]);
  };

  return (
    <div
      style={{
        padding: "40px",
        fontFamily: "Arial",
        maxWidth: "900px",
        margin: "0 auto",
      }}
    >
      <h1>Secure WebRTC Demo</h1>

      <p>
        Signaling server:{" "}
        <strong>{connected ? "Connected" : "Disconnected"}</strong>
      </p>

      {socketId && (
        <p>
          Socket ID: <code>{socketId}</code>
        </p>
      )}

      <div style={{ marginTop: "30px" }}>
        <h2>Local Camera</h2>

        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          style={{
            width: "100%",
            maxWidth: "640px",
            backgroundColor: "#111",
            borderRadius: "8px",
          }}
        />

        <div style={{ marginTop: "15px" }}>
          {!mediaReady ? (
            <button
              onClick={startMedia}
              style={{ padding: "10px 16px" }}
            >
              Start Camera & Microphone
            </button>
          ) : (
            <button
              onClick={stopMedia}
              style={{ padding: "10px 16px" }}
            >
              Stop Camera & Microphone
            </button>
          )}
        </div>

        {mediaError && (
          <p style={{ color: "red" }}>
            {mediaError}
          </p>
        )}
      </div>

      {!joinedRoom ? (
        <div style={{ marginTop: "30px" }}>
          <h2>Join a Room</h2>

          <input
            type="text"
            value={roomId}
            placeholder="Enter room ID"
            onChange={(event) => setRoomId(event.target.value)}
            style={{
              padding: "10px",
              width: "250px",
              marginRight: "10px",
            }}
          />

          <button
            onClick={joinRoom}
            disabled={!connected}
            style={{ padding: "10px 16px" }}
          >
            Join Room
          </button>
        </div>
      ) : (
        <div style={{ marginTop: "30px" }}>
          <h2>Room: {joinedRoom}</h2>

          <p>
            Other peers in room: <strong>{peers.length}</strong>
          </p>

          {peers.length > 0 && (
            <ul>
              {peers.map((peerId) => (
                <li key={peerId}>
                  <code>{peerId}</code>
                </li>
              ))}
            </ul>
          )}

          <button
            onClick={leaveRoom}
            style={{
              padding: "10px 16px",
              marginTop: "15px",
            }}
          >
            Leave Room
          </button>
        </div>
      )}
    </div>
  );
}

export default App;