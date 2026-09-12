import { useEffect, useState } from "react";
import { io } from "socket.io-client";

function App() {
  const [connected, setConnected] = useState(false);
  const [socketId, setSocketId] = useState("");

  useEffect(() => {
    const socket = io("http://localhost:3000");

    socket.on("connect", () => {
      console.log("Connected to signaling server:", socket.id);
      setConnected(true);
      setSocketId(socket.id);
    });

    socket.on("disconnect", () => {
      console.log("Disconnected from signaling server");
      setConnected(false);
      setSocketId("");
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return (
    <div style={{ padding: "40px", fontFamily: "Arial" }}>
      <h1>Secure WebRTC Demo</h1>

      <p>
        Signaling server:
        <strong> {connected ? "Connected" : "Disconnected"}</strong>
      </p>

      {socketId && (
        <p>
          Socket ID: <code>{socketId}</code>
        </p>
      )}
    </div>
  );
}

export default App;