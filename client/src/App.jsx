import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

const ICE_SERVERS = {
  iceServers: [
    {
      urls: "stun:stun.l.google.com:19302",
    },
    {
      urls: "turn:172.26.12.60:3478?transport=udp",
      username: "webrtc",
      credential: "demo12345",
    },
  ],
};

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
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [socketId, setSocketId] = useState("");

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

  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const micAnimationRef = useRef(null);

  const peerConnectionsRef = useRef(new Map());
  const pendingIceCandidatesRef = useRef(new Map());

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
    const source = audioContext.createMediaStreamSource(stream);

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

  const addPendingIceCandidates = async (
    peerId,
    peerConnection
  ) => {
    const pendingCandidates =
      pendingIceCandidatesRef.current.get(peerId) || [];

    for (const candidate of pendingCandidates) {
      try {
        await peerConnection.addIceCandidate(candidate);
      } catch (error) {
        console.error(
          "Failed to add queued ICE candidate:",
          error
        );
      }
    }

    pendingIceCandidatesRef.current.delete(peerId);
  };

  const createPeerConnection = (
    peerId,
    activeSocket
  ) => {
    if (peerConnectionsRef.current.has(peerId)) {
      return peerConnectionsRef.current.get(peerId);
    }

    console.log(
      "Creating RTCPeerConnection for:",
      peerId
    );

    const peerConnection =
      new RTCPeerConnection(ICE_SERVERS);

    peerConnectionsRef.current.set(
      peerId,
      peerConnection
    );

    if (localStreamRef.current) {
      localStreamRef.current
        .getTracks()
        .forEach((track) => {
          peerConnection.addTrack(
            track,
            localStreamRef.current
          );
        });
    }

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        activeSocket.emit(
          "webrtc-ice-candidate",
          {
            target: peerId,
            candidate: event.candidate,
          }
        );
      }
    };

    peerConnection.ontrack = (event) => {
      console.log(
        "Remote track received from:",
        peerId
      );

      const remoteStream = event.streams[0];

      if (
        remoteVideoRef.current &&
        remoteStream
      ) {
        remoteVideoRef.current.srcObject =
          remoteStream;
      }
    };

    peerConnection.onconnectionstatechange = () => {
      console.log(
        `Peer ${peerId} connection state:`,
        peerConnection.connectionState
      );

      setPeerConnectionState(
        peerConnection.connectionState
      );

      if (
        peerConnection.connectionState === "failed" ||
        peerConnection.connectionState === "closed"
      ) {
        peerConnection.close();

        peerConnectionsRef.current.delete(
          peerId
        );
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      console.log(
        `Peer ${peerId} ICE state:`,
        peerConnection.iceConnectionState
      );
    };

    return peerConnection;
  };

  useEffect(() => {
    const newSocket = io(
      "http://localhost:3000"
    );

    setSocket(newSocket);

    newSocket.on("connect", () => {
      console.log(
        "Connected:",
        newSocket.id
      );

      setConnected(true);
      setSocketId(newSocket.id);
    });

    newSocket.on("disconnect", () => {
      setConnected(false);
      setSocketId("");
      setJoinedRoom("");
      setPeers([]);

      setRoomBackground(
        DEFAULT_BACKGROUND
      );

      setPeerConnectionState(
        "Disconnected"
      );

      peerConnectionsRef.current.forEach(
        (peerConnection) => {
          peerConnection.close();
        }
      );

      peerConnectionsRef.current.clear();
    });

    newSocket.on(
      "room-joined",
      async ({ roomId, peers }) => {
        console.log(
          "Joined room:",
          roomId
        );

        console.log(
          "Existing peers:",
          peers
        );

        setJoinedRoom(roomId);
        setPeers(peers);

        // Randomize background every successful room join.
        setRoomBackground(
          getRandomRoomBackground()
        );

        for (const peerId of peers) {
          const peerConnection =
            createPeerConnection(
              peerId,
              newSocket
            );

          try {
            const offer =
              await peerConnection.createOffer();

            await peerConnection.setLocalDescription(
              offer
            );

            newSocket.emit(
              "webrtc-offer",
              {
                target: peerId,
                offer:
                  peerConnection.localDescription,
              }
            );

            console.log(
              "Offer sent to:",
              peerId
            );
          } catch (error) {
            console.error(
              "Failed to create WebRTC offer:",
              error
            );
          }
        }
      }
    );

    newSocket.on(
      "peer-joined",
      ({ peerId }) => {
        console.log(
          "Peer joined:",
          peerId
        );

        setPeers(
          (currentPeers) => {
            if (
              currentPeers.includes(peerId)
            ) {
              return currentPeers;
            }

            return [
              ...currentPeers,
              peerId,
            ];
          }
        );
      }
    );

    newSocket.on(
      "peer-left",
      ({ peerId }) => {
        console.log(
          "Peer left:",
          peerId
        );

        setPeers(
          (currentPeers) =>
            currentPeers.filter(
              (id) => id !== peerId
            )
        );

        const peerConnection =
          peerConnectionsRef.current.get(
            peerId
          );

        if (peerConnection) {
          peerConnection.close();

          peerConnectionsRef.current.delete(
            peerId
          );
        }

        pendingIceCandidatesRef.current.delete(
          peerId
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

    newSocket.on(
      "webrtc-offer",
      async ({ from, offer }) => {
        console.log(
          "WebRTC offer received from:",
          from
        );

        try {
          const peerConnection =
            createPeerConnection(
              from,
              newSocket
            );

          await peerConnection.setRemoteDescription(
            new RTCSessionDescription(
              offer
            )
          );

          await addPendingIceCandidates(
            from,
            peerConnection
          );

          const answer =
            await peerConnection.createAnswer();

          await peerConnection.setLocalDescription(
            answer
          );

          newSocket.emit(
            "webrtc-answer",
            {
              target: from,
              answer:
                peerConnection.localDescription,
            }
          );

          console.log(
            "WebRTC answer sent to:",
            from
          );
        } catch (error) {
          console.error(
            "Failed to process WebRTC offer:",
            error
          );
        }
      }
    );

    newSocket.on(
      "webrtc-answer",
      async ({ from, answer }) => {
        console.log(
          "WebRTC answer received from:",
          from
        );

        const peerConnection =
          peerConnectionsRef.current.get(
            from
          );

        if (!peerConnection) {
          return;
        }

        try {
          await peerConnection.setRemoteDescription(
            new RTCSessionDescription(
              answer
            )
          );

          await addPendingIceCandidates(
            from,
            peerConnection
          );
        } catch (error) {
          console.error(
            "Failed to process WebRTC answer:",
            error
          );
        }
      }
    );

    newSocket.on(
      "webrtc-ice-candidate",
      async ({
        from,
        candidate,
      }) => {
        const peerConnection =
          peerConnectionsRef.current.get(
            from
          );

        if (
          peerConnection &&
          peerConnection.remoteDescription
        ) {
          try {
            await peerConnection.addIceCandidate(
              new RTCIceCandidate(
                candidate
              )
            );
          } catch (error) {
            console.error(
              "Failed to add ICE candidate:",
              error
            );
          }

          return;
        }

        const pendingCandidates =
          pendingIceCandidatesRef.current.get(
            from
          ) || [];

        pendingCandidates.push(
          new RTCIceCandidate(
            candidate
          )
        );

        pendingIceCandidatesRef.current.set(
          from,
          pendingCandidates
        );
      }
    );

    return () => {
      newSocket.disconnect();

      peerConnectionsRef.current.forEach(
        (peerConnection) => {
          peerConnection.close();
        }
      );

      peerConnectionsRef.current.clear();

      stopMicMeter();

      if (localStreamRef.current) {
        localStreamRef.current
          .getTracks()
          .forEach((track) =>
            track.stop()
          );
      }
    };
  }, []);

  const startMedia = async () => {
    try {
      setMediaError("");

      const stream =
        await navigator.mediaDevices.getUserMedia(
          {
            video: true,
            audio: true,
          }
        );

      localStreamRef.current = stream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject =
          stream;
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
        .forEach((track) =>
          track.stop()
        );

      localStreamRef.current = null;
    }

    if (localVideoRef.current) {
      localVideoRef.current.srcObject =
        null;
    }

    setMediaReady(false);
  };

  const joinRoom = () => {
    const trimmedRoomId =
      roomId.trim();

    if (
      !socket ||
      !connected ||
      !trimmedRoomId ||
      !mediaReady
    ) {
      return;
    }

    socket.emit(
      "join-room",
      trimmedRoomId
    );
  };

  const leaveRoom = () => {
    if (
      !socket ||
      !joinedRoom
    ) {
      return;
    }

    socket.emit("leave-room");

    peerConnectionsRef.current.forEach(
      (peerConnection) => {
        peerConnection.close();
      }
    );

    peerConnectionsRef.current.clear();

    pendingIceCandidatesRef.current.clear();

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject =
        null;
    }

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
        Signaling server:{" "}
        <strong>
          {connected
            ? "Connected"
            : "Disconnected"}
        </strong>
      </p>

      {socketId && (
        <p>
          Socket ID:{" "}
          <code>
            {socketId}
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
            onClick={
              startMedia
            }
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
            onClick={
              stopMedia
            }
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
            onChange={(
              event
            ) =>
              setRoomId(
                event.target
                  .value
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
            onClick={
              joinRoom
            }
            disabled={
              !connected ||
              !mediaReady
            }
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
            Other peers in
            room:{" "}
            <strong>
              {peers.length}
            </strong>
          </p>

          {peers.length >
            0 && (
            <ul>
              {peers.map(
                (peerId) => (
                  <li
                    key={
                      peerId
                    }
                  >
                    <code>
                      {
                        peerId
                      }
                    </code>
                  </li>
                )
              )}
            </ul>
          )}

          <button
            onClick={
              leaveRoom
            }
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