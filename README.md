# Cinesrc Stream Resolver

A **reverse-engineering study** of how [Cinesrc](https://cinesrc.st/) resolves embed playback: Next.js **server actions**, client **proof-of-work** challenges, encrypted **`r1.*`** responses, and the **HLS** delivery chain (manifest structure, CDN header checks, and playlist rewriting).

This repository documents and reproduces that behavior in **Node.js** for analysis and verification. It is not a hosted streaming product, embed replacement, or consumer-facing service.

## Scope

The work here is protocol and client-logic reconstruction:

- How the embed app builds routes and `Next-Router-State-Tree` for server-action POSTs
- How stage-1 / stage-2 challenges are generated and bound into a stream token
- How provider lists and stream payloads are returned (including non-plaintext `r1` envelopes)
- How returned sources advertise required **Referer** / **Origin** headers and HLS vs MP4 vs DASH preference
- Why a minimal **m3u8 rewrite proxy** is needed to observe playback in a browser lab (relative segment URLs, `#EXT-X-KEY` URIs, CORS)

A small local HTTP surface and demo page exist only to **trace and confirm** each step—not to operate as infrastructure others should depend on.

## Architecture (reconstructed)

```
TMDB id + embed path
        │
        ▼
┌───────────────────┐
│ Challenge window  │  JSDOM + Canvas — runs site PoW / sandbox checks
│ (headless embed)  │
└─────────┬─────────┘
          │ token (stage1::c2::stage2)
          ▼
┌───────────────────┐
│ Server actions    │  POST + Next-Action + router state tree
│ getProviderList   │  → parse RSC line prefix `1:`
│ getStream         │  → decrypt / decode r1 payload
└─────────┬─────────┘
          │ url[] + per-source headers
          ▼
┌───────────────────┐
│ Source selection  │  HLS → MP4 → DASH → DIRECT
└─────────┬─────────┘
          ▼
┌───────────────────┐
│ HLS proxy (lab)   │  rewrite playlist + forward gated headers
└───────────────────┘
```

### Server actions

Cinesrc exposes stream metadata through **Next.js Server Actions**, not a public REST catalog. Requests require:

- `Next-Action` — action hash (provider list vs stream fetch; stream tokens rotate via an external manifest)
- `Next-Router-State-Tree` — serialized router state matching the embed URL
- `Accept: text/x-component` and a POST body shaped like the production client

Responses arrive as **RSC-style** text; the provider list is extracted from the `1:` line. Stream bodies may be encrypted.

### Challenge pipeline

Before `getStream` accepts a call, the embed runs a **two-stage challenge** inside a controlled window (`lib/challenge-window.js`, `lib/challenge-engine.js`):

1. Stage 1 — site `prodApi.gc()` inside the synthetic document
2. Stage 2 — `__ss2_challenge.gc()` with rate-limit handling (429 → backoff + window reset)

The composed token is appended to the server-action argument list. Failure modes mapped in code: `invalid_challenge`, `bad resp token`, `stage2_issue_429`.

### Response decryption

Encrypted lines use an **`r1.`** prefix. Decryption paths (`lib/response-decrypt.js`):

- In-window `prodApi.dr(payload)` when the runtime exposes it
- Fallback session keys (`__cinesrcSessionKeys`) with local decrypt for captured payloads

This mirrors what the browser does after the challenge—not a separate third-party API.

### HLS and header gating

CDNs tied to embed hosts commonly enforce **Referer** and **Origin**. That is visible in per-source `headers` on stream objects.

The lab proxy (`lib/stream-proxy.js`) exists to study playback mechanics:

- Rewrite non-comment playlist lines to absolute proxy URLs
- Rewrite `URI="..."` inside `#EXT-X-KEY` (and similar) tags
- Strip alternate audio renditions that break simple players during testing
- Forward `Range` and merge default + source-specific headers server-side

## Module map

| Path | What it reverse-engineers |
| --- | --- |
| `lib/content-path.js` | Embed URL ↔ router state tree encoding |
| `lib/constants.js` | Origin, user-agent, action IDs, token manifest URL |
| `lib/challenge-window.js` | Embed DOM bootstrap, PoW hooks, session key capture |
| `lib/challenge-engine.js` | Token assembly, decrypt orchestration, retry policy |
| `lib/cinesrc-api.js` | Server-action POST contract and RSC parsing |
| `lib/response-decrypt.js` | `r1` payload extraction and decryption |
| `lib/stream-sources.js` | Source-type ordering from decoded stream object |
| `lib/stream.js` | Full resolve chain from TMDB inputs to URLs |
| `lib/stream-proxy.js` | HLS manifest rewrite and header injection (analysis aid) |
| `server.mjs` | Local trace endpoints |
| `public/index.html` | Manual verification UI (hls.js) |

## Run locally (analysis only)

```bash
npm install
npm start
```

Listens on `http://127.0.0.1:8787` unless `PORT` is set. Requires **Node.js 18+** and a working **canvas** native build for the challenge window.

Use the root page or curl against the endpoints below to step through provider discovery → resolve → proxied playlist. Keep traffic low; stage 2 is rate-limited upstream.

### Observed endpoints (local)

**Provider list**

```
GET /api/providers?id={tmdbId}&type={movie|tv}&season={n}&episode={n}
```

**Stream resolve** (after reading provider names from the previous call)

```
GET /api/resolve?id={tmdbId}&type={movie|tv}&provider={name}&season={n}&episode={n}
```

Returns upstream `url`, lab `playUrl`, and `source` type.

**Playlist / segment trace**

```
GET /api/proxy?url={encoded}&referer={optional}&h_{header}={value}
```

### Example trace

```bash
curl -s "http://127.0.0.1:8787/api/providers?id=1084242&type=movie" | jq .
curl -s "http://127.0.0.1:8787/api/resolve?id=1084242&type=movie&provider=PROVIDER_FROM_LIST" | jq .
```

## Findings worth noting

| Topic | Observation |
| --- | --- |
| **Action rotation** | Stream action IDs are not hard-coded forever; a Google Apps Script endpoint supplies rotating tokens cached ~2 minutes |
| **RSC transport** | Provider/stream data rides in flight text, not JSON REST—parsing is line-prefix based |
| **Bot resistance** | PoW + encrypted responses + 429 on stage 2; pure `fetch` without the challenge path fails |
| **HLS pitfalls** | Relative segments and key URIs break naive proxies; header forgery must happen server-side |
| **Volatility** | Hashes, challenge scripts, and decrypt hooks change with site deploys—this repo snapshots one era of the logic |

## Disclaimer

Third-party site behavior, terms of use, and copyright apply to anything you inspect with this code. The repository is shared as **technical documentation of client–server mechanics** discovered through analysis. Do not deploy `/api/proxy` on the public internet without controls; it behaves like an open forwarder. No affiliation with Cinesrc or TMDB.

## Further reading

[HTTP Live Streaming (HLS)](https://developer.apple.com/streaming/) · [Next.js Server Actions](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations) · [M3U8 playlist format](https://en.wikipedia.org/wiki/M3U) · [hls.js](https://github.com/video-dev/hls.js/) (used in the local verification page)
