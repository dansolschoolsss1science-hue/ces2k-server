# CES2K server

A tiny WebSocket relay for CES2K online matches.

## Deploy on Render
1. Put this folder in a GitHub repo.
2. Render dashboard -> New -> Web Service -> pick the repo.
3. Build command: `npm install`  |  Start command: `npm start`
4. When it's live you get a URL like `https://ces2k-server.onrender.com`.
   In the game, the server address is the same URL with `wss://`:
   `wss://ces2k-server.onrender.com`

Optional env var: `ALLOWED_ORIGINS=https://codxeditor.com` to only accept connections from your game's site.

Free instances sleep after ~15 min idle; the first connection can take up to a minute to wake it.

## Commentator voice (Fish Audio)
In Render -> Environment add `FISH_API_KEY` (from fish.audio -> API). The voice used is `cedc9cf6ac2d4a6ba28420aa982217f6`; override with `FISH_VOICE_ID`. Without a key the game falls back to the browser voice.
