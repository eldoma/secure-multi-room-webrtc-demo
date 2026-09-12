import { useRef, useState } from "react";
import { MeteredPeer } from "@metered-ca/realtime";

const METERED_API_KEY =
  import.meta.env.VITE_METERED_API_KEY;

const DEFAULT_BACKGROUND = "#15171c";

const ROOM_BACKGROUNDS = [
  "#10281f",
  "#1f2338",
  "#2b1f2f",
  "#172a33",
  "#2d2417",
  "#1f2d26",
  "#2a1f1f",
  "#1d2733",
  "#20253a",
  "#29331d",
];

function App() {
  const [connected, setConnected] = useState(false);
  const [peerId, setPeerId] = useState("");

  const [roomId, setRoomId] = useState("");
  const [joinedRoom, setJoinedRoom] = useState("");
  const [peers, setPeers] = useState([]);

  const [mediaReady, setMediaReady] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [micLevel, setMicLevel] = useState(0);

  const [peerConnectionState, setPeerConnectionState] =
    useState("Not connected");

  const [roomBackground, setRoomBackground] =
    useState(DEFAULT_BACKGROUND);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  const localStreamRef = useRef(null);
  const meteredPeerRef = useRef(null);

  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const micAnimationRef = useRef(null);

  const getRandomRoomBackground = () => {
    return ROOM_BACKGROUNDS[
      Math.floor(Math.random() * ROOM_BACKGROUNDS.length)
    ];
  };

  const stopMicMeter = () => {
    if (micAnimationRef.current) {
      cancelAnimationFrame(micAnimationRef.current);
      micAnimationRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    analyserRef.current = null;
    setMicLevel(0);
  };

  const startMicMeter = async (stream) => {
    stopMicMeter();

    const AudioContext =
      window.AudioContext || window.webkitAudioContext;

    if (!AudioContext) {
      console.warn("Web Audio API is not supported.");
      return;
    }

    const audioTracks = stream.getAudioTracks();

    if (audioTracks.length === 0) {
      console.warn("No microphone audio track found.");
      return;
    }

    const audioContext = new AudioContext();

    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }

    const analyser = audioContext.createAnalyser();
    const source =
      audioContext.createMediaStreamSource(stream);

    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;

    source.connect(analyser);

    const dataArray = new Uint8Array(
      analyser.frequencyBinCount
    );

    audioContextRef.current = audioContext;
    analyserRef.current = analyser;

    const updateMeter = () => {
      analyser.getByteFrequencyData(dataArray);

      const average =
        dataArray.reduce(
          (sum, value) => sum + value,
          0
        ) / dataArray.length;

      const normalizedLevel = Math.min(
        100,
        Math.round((average / 128) * 100)
      );

      setMicLevel(normalizedLevel);

      micAnimationRef.current =
        requestAnimationFrame(updateMeter);
    };

    updateMeter();
  };

  const startMedia = async () => {
    try {
      setMediaError("");

      const stream =
        await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

      localStreamRef.current = stream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }

      await startMicMeter(stream);

      setMediaReady(true);
    } catch (error) {
      console.error(
        "Media access failed:",
        error
      );

      setMediaError(
        "Could not access camera or microphone. Check browser permissions."
      );
    }
  };

  const stopMedia = () => {
    stopMicMeter();

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

  const joinRoom = async () => {
    const trimmedRoomId = roomId.trim();

    if (
      !trimmedRoomId ||
      !mediaReady ||
      !localStreamRef.current
    ) {
      return;
    }

    try {
      setPeerConnectionState("Connecting");
      setPeers([]);

      const meteredPeer = new MeteredPeer({
        apiKey: METERED_API_KEY,
      });

      meteredPeerRef.current = meteredPeer;

      meteredPeer.on(
        "peer-joined",
        ({ peer: remote }) => {
          console.log(
            "Metered peer joined:",
            remote.id
          );

          setPeers((currentPeers) => {
            if (currentPeers.includes(remote.id)) {
              return currentPeers;
            }

            return [
              ...currentPeers,
              remote.id,
            ];
          });

          remote.on(
            "track",
            ({ streams }) => {
              console.log(
                "Remote media received:",
                remote.id
              );

              if (
                remoteVideoRef.current &&
                streams &&
                streams[0]
              ) {
                remoteVideoRef.current.srcObject =
                  streams[0];

                setPeerConnectionState(
                  "connected"
                );
              }
            }
          );
        }
      );

      meteredPeer.on(
        "peer-left",
        ({ peer: remote }) => {
          console.log(
            "Metered peer left:",
            remote.id
          );

          setPeers((currentPeers) =>
            currentPeers.filter(
              (id) => id !== remote.id
            )
          );

          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject =
              null;
          }

          setPeerConnectionState(
            "Peer left"
          );
        }
      );

      meteredPeer.addStream(
        localStreamRef.current
      );

      await meteredPeer.join(
        trimmedRoomId
      );

      setConnected(true);
      setJoinedRoom(trimmedRoomId);

      /*
       * Metered assigns the browser peer ID.
       * Some SDK versions expose it after join.
       */
      if (meteredPeer.id) {
        setPeerId(meteredPeer.id);
      }

      setRoomBackground(
        getRandomRoomBackground()
      );

      console.log(
        "Joined Metered room:",
        trimmedRoomId
      );
    } catch (error) {
      console.error(
        "Failed to join Metered room:",
        error
      );

      setConnected(false);
      setPeerConnectionState(
        "Connection failed"
      );
    }
  };

  const leaveRoom = async () => {
    const meteredPeer =
      meteredPeerRef.current;

    if (meteredPeer) {
      try {
        await meteredPeer.close();
      } catch (error) {
        console.error(
          "Failed to close Metered connection:",
          error
        );
      }

      meteredPeerRef.current = null;
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject =
        null;
    }

    setConnected(false);
    setPeerId("");
    setJoinedRoom("");
    setPeers([]);

    setRoomBackground(
      DEFAULT_BACKGROUND
    );

    setPeerConnectionState(
      "Not connected"
    );
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: "40px",
        fontFamily: "Arial",
        maxWidth: "1100px",
        margin: "0 auto",
        backgroundColor:
          roomBackground,
        transition:
          "background-color 0.45s ease",
      }}
    >
      <h1>
        Secure WebRTC Demo
      </h1>

      <p>
        Metered signaling:{" "}
        <strong>
          {connected
            ? "Connected"
            : "Disconnected"}
        </strong>
      </p>

      {peerId && (
        <p>
          Peer ID:{" "}
          <code>
            {peerId}
          </code>
        </p>
      )}

      <div
        style={{
          display: "flex",
          gap: "20px",
          flexWrap: "wrap",
          marginTop: "30px",
        }}
      >
        <div
          style={{
            flex: "1",
            minWidth: "320px",
          }}
        >
          <h2>
            Local Camera
          </h2>

          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            style={{
              width: "100%",
              backgroundColor:
                "#111",
              borderRadius:
                "8px",
            }}
          />
        </div>

        <div
          style={{
            flex: "1",
            minWidth: "320px",
          }}
        >
          <h2>
            Remote Peer
          </h2>

          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            style={{
              width: "100%",
              backgroundColor:
                "#111",
              borderRadius:
                "8px",
            }}
          />

          <p>
            WebRTC state:{" "}
            <strong>
              {peerConnectionState}
            </strong>
          </p>
        </div>
      </div>

      <div
        style={{
          marginTop: "15px",
        }}
      >
        {!mediaReady ? (
          <button
            onClick={startMedia}
            style={{
              padding:
                "10px 16px",
            }}
          >
            Start Camera &
            Microphone
          </button>
        ) : (
          <button
            onClick={stopMedia}
            style={{
              padding:
                "10px 16px",
            }}
          >
            Stop Camera &
            Microphone
          </button>
        )}

        {mediaError && (
          <p
            style={{
              color: "red",
            }}
          >
            {mediaError}
          </p>
        )}

        {mediaReady && (
          <div
            style={{
              marginTop:
                "20px",
              maxWidth:
                "400px",
            }}
          >
            <p>
              Microphone level:{" "}
              <strong>
                {micLevel}%
              </strong>
            </p>

            <div
              style={{
                height:
                  "20px",
                backgroundColor:
                  "#333",
                borderRadius:
                  "10px",
                overflow:
                  "hidden",
              }}
            >
              <div
                style={{
                  height:
                    "100%",
                  width: `${micLevel}%`,
                  backgroundColor:
                    "#4caf50",
                  transition:
                    "width 0.08s linear",
                }}
              />
            </div>
          </div>
        )}
      </div>

      {!joinedRoom ? (
        <div
          style={{
            marginTop:
              "30px",
          }}
        >
          <h2>
            Join a Room
          </h2>

          {!mediaReady && (
            <p>
              Start your camera
              and microphone
              before joining a
              room.
            </p>
          )}

          <input
            type="text"
            value={roomId}
            placeholder="Enter room ID"
            onChange={(event) =>
              setRoomId(
                event.target.value
              )
            }
            style={{
              padding:
                "10px",
              width:
                "250px",
              marginRight:
                "10px",
            }}
          />

          <button
            onClick={joinRoom}
            disabled={!mediaReady}
            style={{
              padding:
                "10px 16px",
            }}
          >
            Join Room
          </button>
        </div>
      ) : (
        <div
          style={{
            marginTop:
              "30px",
          }}
        >
          <h2>
            Room:{" "}
            {joinedRoom}
          </h2>

          <p>
            Other peers in room:{" "}
            <strong>
              {peers.length}
            </strong>
          </p>

          {peers.length > 0 && (
            <ul>
              {peers.map(
                (remotePeerId) => (
                  <li
                    key={
                      remotePeerId
                    }
                  >
                    <code>
                      {
                        remotePeerId
                      }
                    </code>
                  </li>
                )
              )}
            </ul>
          )}

          <button
            onClick={leaveRoom}
            style={{
              padding:
                "10px 16px",
              marginTop:
                "15px",
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