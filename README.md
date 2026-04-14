# Cup Phone Chat

Simple 2-person voice chat web app inspired by cup phones.

## Do you need a real server?
Yes.

This app uses:
- Static frontend files (`public/*`)
- A WebSocket signaling server (`server.js`) for WebRTC offer/answer/ICE exchange

If you deploy only static files (for example pure static hosting), calls will not connect because signaling is missing.

## Local run

```bash
npm install
npm start
```

Open `http://localhost:3000` in two browsers/devices and join the same room.

## Deploy (recommended)

Deploy to a platform that supports long-running Node processes and WebSockets:
- Render (Web Service)
- Railway
- Fly.io
- VPS (Docker/PM2)

Start command:

```bash
npm start
```

## Environment variables

- `PORT`: provided by most platforms automatically
- `ICE_SERVERS` (optional but recommended for production): JSON array for WebRTC ICE servers

Example with STUN + TURN:

```json
[
  { "urls": "stun:stun.l.google.com:19302" },
  {
    "urls": "turn:turn.yourdomain.com:3478",
    "username": "turn-user",
    "credential": "turn-password"
  }
]
```

Set this JSON string as the `ICE_SERVERS` env value in your deploy platform.

## Notes for production reliability

- Use HTTPS (browser requires secure context for microphone in production).
- For users on strict networks/mobile carriers, TURN is often required.
- Room capacity is limited to exactly 2 users by signaling server.
