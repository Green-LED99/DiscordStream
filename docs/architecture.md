# Architecture

## Overview

`discord-stream` is a one-shot CLI worker. A caller provides a guild id, voice channel id, and a direct `.mp4` or `.mkv` URL. The worker:

1. Validates the media URL.
2. Loads the official `libdave` WASM artifacts.
3. Logs in as a companion Discord user client.
4. Joins the target guild voice channel.
5. Creates a Go Live stream.
6. Transcodes the media source to `H.264 + Opus` with `ffmpeg`.
7. Demuxes the NUT stream into encoded video/audio packets.
8. Encrypts encoded frames with DAVE before RTP packetization.
9. Sends frames through WebRTC to Discord.

## Main Components

- `src/runtime/run-stream-job.ts`
  Orchestrates the full job lifecycle, signal handling, cleanup, and lifecycle reporting.
- `src/discord`
  Owns the Discord gateway bridge, voice websocket, Go Live creation, and RTP signaling.
- `src/dave`
  Wraps the official `libdave` WASM bindings and adapts the upstream TypeScript DAVE session flow.
- `src/media`
  Validates media URLs, probes source media, spawns `ffmpeg`, and demuxes encoded packets from NUT.
- `src/transport`
  Configures `node-datachannel` packetizers and pushes DAVE-encrypted frames onto Discord's RTP transport.

## Process Model

- Lifecycle events are emitted as JSON lines on stdout.
- Structured logs are emitted as JSON lines on stderr.
- The process exits after the stream completes, fails, or receives `SIGINT` / `SIGTERM`.

