# discord-stream

`discord-stream` is a companion CLI that signs in as a separate Discord user client, joins a guild voice channel, creates a Go Live stream, and pushes a direct `.mp4` or `.mkv` URL into the call using Discord's DAVE media encryption.

If another agent needs to operate this repository, start with `docs/agent-runbook.md`. That file is the shortest complete handoff for build, runtime, and failure handling.

## Status

This repository is a Docker-first implementation. The runtime contract and source code are in place, but the full native stack depends on:

- `libdave` WASM artifacts built from the official source
- `node-av`
- `@lng2004/node-datachannel`
- a valid companion Discord user token

## Quickstart

### Local Build

1. Copy `.env.example` to `.env`.
2. Set `DISCORD_COMPANION_TOKEN`.
3. Build the official `libdave` artifacts:

```bash
npm run build:libdave
```

4. Install dependencies and compile:

```bash
npm install
npm run build
```

5. Run the CLI:

```bash
node dist/src/cli.js play-url \
  --guild-id 123 \
  --channel-id 456 \
  --url https://example.com/video.mp4 \
  --json
```

### Docker Build

Build the image:

```bash
docker build -t discord-stream:local .
```

Run a stream job:

```bash
docker run --rm \
  --env-file .env \
  discord-stream:local \
  play-url \
  --guild-id 123 \
  --channel-id 456 \
  --url https://example.com/video.mp4 \
  --json
```

## Agent Integration Contract

- Invoke one process per stream job.
- Pass only direct `http` or `https` `.mp4` or `.mkv` URLs.
- Read lifecycle events from `stdout` as JSON lines.
- Treat `stderr` as structured logs.
- Send `SIGTERM` to stop the stream and trigger cleanup.
- Do not reuse the process for multiple jobs.

Example success path on `stdout`:

```json
{"event":"authenticating","timestamp":"2026-03-09T00:00:00.000Z","details":{"guildId":"123","channelId":"456","mode":"go-live"}}
{"event":"resolved_media","timestamp":"2026-03-09T00:00:01.000Z","details":{"url":"https://example.com/video.mp4","streamCount":2}}
{"event":"joining_voice","timestamp":"2026-03-09T00:00:02.000Z","details":{"guildId":"123","channelId":"456","userId":"789"}}
{"event":"starting_stream","timestamp":"2026-03-09T00:00:03.000Z","details":{"url":"https://example.com/video.mp4","mode":"go-live"}}
{"event":"completed","timestamp":"2026-03-09T00:10:03.000Z","details":{"guildId":"123","channelId":"456"}}
```

Failure shape:

```json
{"event":"failed","timestamp":"2026-03-09T00:00:03.000Z","details":{"message":"The provided media URL is invalid.","exitCode":40}}
```

## Exit Codes

- `0`: success
- `10`: configuration error
- `20`: authentication error
- `30`: Discord gateway / voice signaling failure
- `40`: media validation or transcoding failure
- `50`: DAVE failure
- `60`: transport failure
- `70`: unexpected internal failure

## Docs

- `docs/architecture.md`
- `docs/agent-runbook.md`
- `docs/dave-notes.md`
- `docs/cli-contract.md`
- `docs/ops.md`
- `docs/adr/0001-companion-user-client.md`
