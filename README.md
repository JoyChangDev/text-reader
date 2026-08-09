This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.jsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Environment

Set these in `.env.local` for development, and in the Vercel project for deploys.

Object storage (Cloudflare R2 — see [the phase 1.11 spec](specs/phase-1-11-object-storage-migration.md)):

- `R2_ACCOUNT_ID` — Cloudflare account ID. The S3 endpoint is `https://<id>.r2.cloudflarestorage.com`.
- `R2_BUCKET` — bucket name (`text-reader`).
- `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` — an R2 API token for the app. It is used for writes;
  the segment Worker reaches the bucket through a binding and holds no credentials of its own.
- `SEGMENT_ORIGIN` — where a Listener plays segments from, i.e. the Worker's origin.
  **Keep the trailing slash**: segment URLs are the origin concatenated with the object pathname.

Redis (Upstash, under the legacy Vercel KV names — see [app/\_lib/upstashRedis.js](app/_lib/upstashRedis.js)):

- `KV_REST_API_URL` / `KV_REST_API_TOKEN` — the Chunk index and the resume position. Absent
  credentials are not an error: the app still plays, just without the index's shortcuts.

Optional:

- `BLOB_QUOTA_BYTES` — overrides the denominator the capacity indicator reports against.

The bucket is private. The app writes to it over the S3 API, and
[`workers/segments/`](workers/segments/README.md) is the only public read path, so `SEGMENT_ORIGIN`
is a different host from the one writes go to. That is why the storage client builds a segment's
URL from configuration rather than from the response to the write that stored it.

Absent R2 settings are not silently tolerated: the storage client throws on first use, naming what
is missing, rather than reporting a store that looks empty.
