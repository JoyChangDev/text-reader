# 09 — Production deployment on Vercel

**What to build:** Configure the Vercel project (environment variables including the Blob storage token) and deploy the app, then verify the complete Phase 1 flow — upload, progressive playback, library/resume, and cached replay — works end-to-end against the live deployed URL rather than only on localhost.

**Blocked by:** 07 — Local library with resume position, 08 — Chunk generation error + manual retry UI

**Status:** done

- [x] The app is deployed and reachable at a Vercel URL
- [x] All required environment variables (including the Vercel Blob token) are configured for the production deployment
- [x] Uploading a `.txt` file on the live URL triggers progressive playback starting within a couple of seconds, matching local behavior
- [x] The library and resume-position features work correctly against the live deployment
- [x] Revisiting a previously read book on the live deployment replays already-generated chunks from cache without new `edge-tts` calls

## Comments

Deployed to Vercel at https://text-reader-theta.vercel.app (project `joy-chang-dev/text-reader`), with a public Vercel Blob store created and linked, auto-injecting `BLOB_READ_WRITE_TOKEN` for Production/Preview/Development.

Hit one real build failure along the way: `npm install`'s `prepare` script (`git config core.hooksPath .githooks`) fails on Vercel's build machine because CLI deploys upload the working tree without `.git`, so the first production build errored with `npm install exited with 128`. Fixed by guarding the script in `package.json` to no-op when not inside a git repo, verified locally both inside and outside a git directory before redeploying.

End-to-end verification: `POST /api/chunks` and `POST /api/audio-chunks` confirmed directly against the live URL (chunking, first-call generation ~2.1s, second-call cache hit ~0.6s returning the same audio URL, and the resulting blob URL serving a real playable `audio/mpeg` file publicly). UI flow (upload triggers fast playback, play/pause, library entry appears after reload, resuming from the library replays instantly from cache) manually confirmed by the user against the live deployment.
