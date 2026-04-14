# Deploy Guide (Railway + Vercel)

This app should be deployed as:
- Backend signaling server: Railway
- Frontend web app: Vercel

## 1) Deploy backend to Railway

1. Push this repo to GitHub.
2. In Railway, create a new project from this repo.
3. Railway will detect Node.js and run `npm start`.
4. After deploy, copy your public URL, for example:
   - `https://cup-phone-api.up.railway.app`

Optional but recommended in Railway variables:
- `ICE_SERVERS` as JSON string for STUN/TURN in production

Example:

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

## 2) Point frontend to Railway backend

Edit [public/app-config.js](public/app-config.js) and set:

```javascript
window.APP_CONFIG = window.APP_CONFIG || {
  SIGNAL_SERVER_URL: "wss://cup-phone-api.up.railway.app"
};
```

You can also use `https://...`; app will auto-convert to `wss://`.

## 3) Deploy frontend to Vercel

1. Import the same repo into Vercel.
2. Deploy with default settings.
3. Vercel serves from [public](public) via [vercel.json](vercel.json).

## 4) Test production

1. Open Vercel URL in two different devices/browsers.
2. Join same room code.
3. Allow microphone access.
4. Confirm voice connects and status updates.

## Notes

- Vercel serverless functions are not used for signaling here.
- WebSocket signaling runs from Railway.
- HTTPS/WSS is required in production for microphone and secure transport.
