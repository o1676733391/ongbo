const roomInput = document.getElementById("roomInput");
const joinBtn = document.getElementById("joinBtn");
const copyLinkBtn = document.getElementById("copyLinkBtn");
const statusText = document.getElementById("status");

const localCup = document.getElementById("localCup");
const remoteCup = document.getElementById("remoteCup");
const localVoiceStatus = document.getElementById("localVoiceStatus");
const remoteVoiceStatus = document.getElementById("remoteVoiceStatus");
const stringLine = document.getElementById("stringLine");
const remoteAudio = document.getElementById("remoteAudio");

const roomFromQuery = new URLSearchParams(window.location.search).get("room");
if (roomFromQuery) {
  roomInput.value = roomFromQuery;
}

let socket;
let localStream;
let peer;
let localLevelChecker;
let remoteLevelChecker;
let roomId;
let iceServers = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" }
];

async function loadRtcConfig() {
  try {
    const response = await fetch("/config", { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    if (Array.isArray(data.iceServers) && data.iceServers.length > 0) {
      iceServers = data.iceServers;
    }
  } catch {
    // Keep default STUN config when endpoint is unavailable.
  }
}

function setStatus(message) {
  statusText.textContent = message;
}

function getMicErrorMessage(err) {
  const name = err && err.name ? err.name : "UnknownError";

  if (!window.isSecureContext) {
    return "Microphone requires HTTPS on mobile. Open the deployed HTTPS URL, not local http.";
  }

  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Microphone permission denied. Enable mic permission for this site in browser settings and reload.";
  }

  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No microphone detected on this device.";
  }

  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Microphone is busy in another app. Close other apps using mic and try again.";
  }

  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
    return "This device cannot satisfy microphone constraints.";
  }

  if (name === "SecurityError") {
    return "Browser blocked microphone for security reasons. Try Chrome/Safari directly, not in-app browser.";
  }

  return `Cannot use microphone (${name}). Check browser permission and try again.`;
}

function setSpeaking(el, speaking) {
  el.classList.toggle("speaking", speaking);

  const statusEl = el === localCup ? localVoiceStatus : remoteVoiceStatus;
  if (statusEl) {
    statusEl.classList.toggle("speaking", speaking);
    statusEl.textContent = speaking ? "Voice: talking" : "Voice: quiet";
  }

  const eitherSpeaking = localCup.classList.contains("speaking") || remoteCup.classList.contains("speaking");
  stringLine.classList.toggle("speaking", eitherSpeaking);
}

function monitorStreamLevel(stream, element, threshold = 0.045) {
  const audioContext = new AudioContext();
  const src = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;

  src.connect(analyser);

  const data = new Uint8Array(analyser.frequencyBinCount);
  let rafId;

  const tick = () => {
    analyser.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) {
      sum += data[i];
    }
    const average = sum / data.length / 255;
    setSpeaking(element, average > threshold);
    rafId = requestAnimationFrame(tick);
  };

  tick();

  return () => {
    cancelAnimationFrame(rafId);
    setSpeaking(element, false);
    src.disconnect();
    analyser.disconnect();
    audioContext.close();
  };
}

async function ensureMedia() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("This browser does not support microphone access.");
  }

  if (!window.isSecureContext) {
    throw new Error("Microphone requires HTTPS (or localhost).");
  }

  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    if (localLevelChecker) {
      localLevelChecker();
    }
    localLevelChecker = monitorStreamLevel(localStream, localCup, 0.06);
  }
  return localStream;
}

async function createPeerConnection() {
  if (peer) {
    return peer;
  }

  const stream = await ensureMedia();
  peer = new RTCPeerConnection({ iceServers });

  stream.getTracks().forEach((track) => {
    peer.addTrack(track, stream);
  });

  peer.onicecandidate = (event) => {
    if (event.candidate) {
      socket.send(JSON.stringify({ type: "ice-candidate", candidate: event.candidate }));
    }
  };

  peer.ontrack = (event) => {
    const [streamFromPeer] = event.streams;
    remoteAudio.srcObject = streamFromPeer;

    if (remoteLevelChecker) {
      remoteLevelChecker();
    }
    remoteLevelChecker = monitorStreamLevel(streamFromPeer, remoteCup, 0.02);
  };

  peer.onconnectionstatechange = () => {
    if (peer.connectionState === "connected") {
      setStatus("Connected. Start talking into your cup.");
    }

    if (["failed", "disconnected", "closed"].includes(peer.connectionState)) {
      setStatus("Connection ended. Join again to reconnect.");
    }
  };

  return peer;
}

function getSignalUrl() {
  const configuredUrl = window.APP_CONFIG && window.APP_CONFIG.SIGNAL_SERVER_URL
    ? String(window.APP_CONFIG.SIGNAL_SERVER_URL).trim()
    : "";

  if (configuredUrl) {
    if (configuredUrl.startsWith("ws://") || configuredUrl.startsWith("wss://")) {
      return configuredUrl;
    }
    if (configuredUrl.startsWith("https://")) {
      return configuredUrl.replace("https://", "wss://");
    }
    if (configuredUrl.startsWith("http://")) {
      return configuredUrl.replace("http://", "ws://");
    }
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}`;
}

async function handleSignalMessage(message) {
  if (message.type === "joined") {
    if (message.users > 2) {
      setStatus("Room already has 2 people. Try another room.");
      return;
    }
    setStatus("Joined. Waiting for your friend...");
    return;
  }

  if (message.type === "ready") {
    setStatus("Both cups are here. Building the line...");
    const pc = await createPeerConnection();

    if (message.initiator && pc.signalingState === "stable") {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.send(JSON.stringify({ type: "offer", offer }));
    }
    return;
  }

  if (message.type === "offer") {
    const pc = await createPeerConnection();
    await pc.setRemoteDescription(new RTCSessionDescription(message.offer));

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.send(JSON.stringify({ type: "answer", answer }));
    return;
  }

  if (message.type === "answer") {
    if (peer) {
      await peer.setRemoteDescription(new RTCSessionDescription(message.answer));
    }
    return;
  }

  if (message.type === "ice-candidate") {
    if (peer) {
      await peer.addIceCandidate(new RTCIceCandidate(message.candidate));
    }
    return;
  }

  if (message.type === "peer-left") {
    setStatus("Your friend left. Stay here or rejoin later.");
    if (remoteLevelChecker) {
      remoteLevelChecker();
      remoteLevelChecker = null;
    }
    remoteAudio.srcObject = null;
    return;
  }

  if (message.type === "error") {
    setStatus(message.message || "Something went wrong.");
  }
}

async function joinRoom() {
  roomId = roomInput.value.trim();
  if (!roomId) {
    setStatus("Please enter a room code.");
    return;
  }

  joinBtn.disabled = true;
  setStatus("Requesting microphone and joining room...");

  try {
    await ensureMedia();
    await loadRtcConfig();

    const params = new URLSearchParams(window.location.search);
    params.set("room", roomId);
    window.history.replaceState({}, "", `?${params.toString()}`);

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close();
    }

    socket = new WebSocket(getSignalUrl());

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "join", roomId }));
    };

    socket.onmessage = async (event) => {
      const message = JSON.parse(event.data);
      try {
        await handleSignalMessage(message);
      } catch (err) {
        setStatus(`Signal error: ${err.message}`);
      }
    };

    socket.onclose = () => {
      joinBtn.disabled = false;
      if (!remoteAudio.srcObject) {
        setStatus("Disconnected from server.");
      }
    };

    socket.onerror = () => {
      setStatus("Network error while connecting.");
      joinBtn.disabled = false;
    };
  } catch (err) {
    setStatus(getMicErrorMessage(err));
    joinBtn.disabled = false;
  }
}

function copyInviteLink() {
  const roomCode = roomInput.value.trim();
  if (!roomCode) {
    setStatus("Enter a room code first, then copy invite link.");
    return;
  }

  const inviteUrl = new URL(window.location.href);
  inviteUrl.searchParams.set("room", roomCode);

  navigator.clipboard
    .writeText(inviteUrl.toString())
    .then(() => {
      setStatus("Invite link copied. Send it to your friend.");
    })
    .catch(() => {
      setStatus("Could not copy link. Copy the URL from your browser bar.");
    });
}

joinBtn.addEventListener("click", joinRoom);
copyLinkBtn.addEventListener("click", copyInviteLink);
roomInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    joinRoom();
  }
});
