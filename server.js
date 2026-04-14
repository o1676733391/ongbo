const express = require("express");
const http = require("http");
const path = require("path");
const { WebSocketServer } = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map();

function getIceServers() {
  // Optional env override for deployment, e.g. TURN credentials.
  // Expected format in ICE_SERVERS: JSON array for RTCPeerConnection iceServers.
  if (process.env.ICE_SERVERS) {
    try {
      const parsed = JSON.parse(process.env.ICE_SERVERS);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch {
      // Fall through to default public STUN servers.
    }
  }

  return [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" }
  ];
}

app.use(express.static(path.join(__dirname, "public")));

app.get("/config", (_req, res) => {
  res.json({ iceServers: getIceServers() });
});

wss.on("connection", (ws) => {
  let currentRoomId = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "join") {
      const roomId = String(msg.roomId || "").trim();
      if (!roomId) {
        ws.send(JSON.stringify({ type: "error", message: "Missing room id" }));
        return;
      }

      if (!rooms.has(roomId)) {
        rooms.set(roomId, new Set());
      }

      const peers = rooms.get(roomId);

      if (peers.size >= 2) {
        ws.send(
          JSON.stringify({
            type: "error",
            message: "This room already has 2 people"
          })
        );
        return;
      }

      currentRoomId = roomId;
      peers.add(ws);

      ws.send(
        JSON.stringify({
          type: "joined",
          roomId,
          users: peers.size
        })
      );

      if (peers.size === 2) {
        // Deterministic roles avoid simultaneous offer collisions.
        const [first, second] = Array.from(peers);
        if (first && first.readyState === first.OPEN) {
          first.send(JSON.stringify({ type: "ready", initiator: true }));
        }
        if (second && second.readyState === second.OPEN) {
          second.send(JSON.stringify({ type: "ready", initiator: false }));
        }
      }

      return;
    }

    if (!currentRoomId || !rooms.has(currentRoomId)) {
      return;
    }

    const peers = rooms.get(currentRoomId);

    if (["offer", "answer", "ice-candidate"].includes(msg.type)) {
      for (const client of peers) {
        if (client !== ws && client.readyState === client.OPEN) {
          client.send(JSON.stringify(msg));
        }
      }
    }
  });

  ws.on("close", () => {
    if (!currentRoomId) {
      return;
    }

    const peers = rooms.get(currentRoomId);
    if (!peers) {
      return;
    }

    peers.delete(ws);

    for (const client of peers) {
      if (client.readyState === client.OPEN) {
        client.send(JSON.stringify({ type: "peer-left" }));
      }
    }

    if (peers.size === 0) {
      rooms.delete(currentRoomId);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Cup phone app running on http://localhost:${PORT}`);
});
