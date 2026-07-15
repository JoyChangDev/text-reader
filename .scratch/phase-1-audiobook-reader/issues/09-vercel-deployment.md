# 09 — Production deployment on Vercel

**What to build:** Configure the Vercel project (environment variables including the Blob storage token) and deploy the app, then verify the complete Phase 1 flow — upload, progressive playback, library/resume, and cached replay — works end-to-end against the live deployed URL rather than only on localhost.

**Blocked by:** 07 — Local library with resume position, 08 — Chunk generation error + manual retry UI

**Status:** ready-for-agent

- [ ] The app is deployed and reachable at a Vercel URL
- [ ] All required environment variables (including the Vercel Blob token) are configured for the production deployment
- [ ] Uploading a `.txt` file on the live URL triggers progressive playback starting within a couple of seconds, matching local behavior
- [ ] The library and resume-position features work correctly against the live deployment
- [ ] Revisiting a previously read book on the live deployment replays already-generated chunks from cache without new `edge-tts` calls
