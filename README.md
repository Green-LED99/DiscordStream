# DiscordStream

`DiscordStream` is a one-shot CLI worker that signs in as a separate Discord user client, joins a guild voice channel, creates a Go Live stream, and forwards a direct `.mp4` or `.mkv` URL into the call using Discord voice/video signaling plus DAVE frame encryption.

This README is written for AI agents first. It describes what is actually implemented in the repository, how to invoke it safely, where the critical code lives, and what was verified locally.

## What This Repository Does

- Resolves a companion user token from `env`, `file`, or `command` provider config
- Opens a custom Discord user gateway session
- Joins a guild voice channel through the documented `VOICE_STATE_UPDATE` + `VOICE_SERVER_UPDATE` handshake
- Creates a Go Live stream through the documented `STREAM_CREATE` + `STREAM_SERVER_UPDATE` handshake
- Connects voice and stream websockets on voice gateway `v=9`
- Negotiates DAVE through `libdave`
- Probes the media URL with `ffprobe`
- Either copies cheap-enough media or transcodes to a lower-CPU stream profile
- Emits machine-readable lifecycle events on `stdout`
- Emits structured operational logs on `stderr`

## Hard Scope

Supported:

- Guild voice channels only
- `play-url` command only
- `http` / `https` direct `.mp4` and `.mkv` URLs only
- Go Live mode only
- Companion user token only
- Linux container packaging via Docker

Not supported:

- Bot tokens
- Stage channels
- DM/GDM calls
- YouTube, HLS, playlist URLs, or generic webpage URLs
- Camera mode
- Multi-job worker reuse

## First-Time Use

If you are another agent and need the shortest reliable path, use Docker first.

1. Create `.env` from [`.env.example`](/Users/harrisonpope/Desktop/DiscordStream/.env.example).
2. Choose exactly one companion token source.
3. Build the image.
4. Run one `play-url` job.
5. Watch `stdout` JSON for lifecycle state and `stderr` for diagnostics.

## Required Environment

From [src/config.ts](/Users/harrisonpope/Desktop/DiscordStream/src/config.ts) and [src/companion-token-provider.ts](/Users/harrisonpope/Desktop/DiscordStream/src/companion-token-provider.ts):

- Exactly one companion token source must be configured:
  - `DISCORD_COMPANION_TOKEN`
  - `DISCORD_COMPANION_TOKEN_FILE`
  - `DISCORD_COMPANION_TOKEN_COMMAND`
- `DISCORD_COMPANION_TOKEN_PROVIDER` optional, but required if more than one source variable is present
- `DISCORD_COMPANION_TOKEN_COMMAND_TIMEOUT_MS` optional, defaults to `5000`
- `LOG_LEVEL` optional, defaults to `info`
- `FFMPEG_PATH` optional, defaults to `ffmpeg`
- `FFPROBE_PATH` optional, defaults to `ffprobe`

Provider rules:

- `env`: reads `DISCORD_COMPANION_TOKEN`
- `file`: reads a UTF-8 token file from `DISCORD_COMPANION_TOKEN_FILE`
- `command`: runs `/bin/sh -lc "$DISCORD_COMPANION_TOKEN_COMMAND"` and reads trimmed `stdout`
- token resolution happens once per stream job, immediately before Discord Gateway login
- the worker does not implement username/password login, OAuth2 bearer auth, or mid-run token refresh

Recommended defaults:

- Local development: `env`
- Docker or deployed runs: `file`
- Secret-manager integration: `command`

Example [`.env`](/Users/harrisonpope/Desktop/DiscordStream/.env):

```dotenv
DISCORD_COMPANION_TOKEN_PROVIDER=env
DISCORD_COMPANION_TOKEN=your_user_token_here
LOG_LEVEL=debug
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
```

Example file-backed config:

```dotenv
DISCORD_COMPANION_TOKEN_PROVIDER=file
DISCORD_COMPANION_TOKEN_FILE=.secrets/discord-companion-token.txt
LOG_LEVEL=info
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
```

Example command-backed config:

```dotenv
DISCORD_COMPANION_TOKEN_PROVIDER=command
DISCORD_COMPANION_TOKEN_COMMAND=security find-generic-password -a discord-stream -s companion-token -w
DISCORD_COMPANION_TOKEN_COMMAND_TIMEOUT_MS=5000
LOG_LEVEL=info
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
```

## Docker Path

The Docker image now includes `ffmpeg` and `ffprobe` in the runtime layer, so the containerized path is self-contained apart from the token source and the media URL.

Build:

```bash
docker buildx build --platform linux/amd64 -t discord-stream:local --load .
```

Run:

```bash
docker run --rm \
  --env-file .env \
  discord-stream:local \
  play-url \
  --guild-id 123456789012345678 \
  --channel-id 234567890123456789 \
  --url https://example.com/video.mp4 \
  --json
```

Recommended Docker secret path:

```bash
mkdir -p .secrets
printf '%s\n' "$DISCORD_COMPANION_TOKEN" > .secrets/discord-companion-token.txt

docker run --rm \
  -e DISCORD_COMPANION_TOKEN_PROVIDER=file \
  -e DISCORD_COMPANION_TOKEN_FILE=/run/secrets/discord-companion-token.txt \
  -e LOG_LEVEL=info \
  -v "$(pwd)/.secrets:/run/secrets:ro" \
  discord-stream:local \
  play-url \
  --guild-id 123456789012345678 \
  --channel-id 234567890123456789 \
  --url https://example.com/video.mp4 \
  --json
```

Stop:

- send `SIGTERM`, or
- press `Ctrl+C` when running interactively

The worker handles `SIGINT` and `SIGTERM`, aborts the media loop, leaves voice, destroys the gateway session, and exits.

## Local Development Path

Use this when you need to patch code, run tests, or debug without Docker.

Prerequisites:

- Node `22.x`
- `ffmpeg`
- `ffprobe`
- `EMSDK` set for the `libdave` build

Build:

```bash
npm install
npm run build:libdave
npm run build
```

Run:

```bash
node dist/src/cli.js play-url \
  --guild-id 123456789012345678 \
  --channel-id 234567890123456789 \
  --url https://example.com/video.mp4 \
  --json
```

`npm run build:libdave` clones the official `discord/libdave` repo and writes artifacts into [vendor/libdave](/Users/harrisonpope/Desktop/DiscordStream/vendor/libdave). The runtime loader in [src/dave/libdave.ts](/Users/harrisonpope/Desktop/DiscordStream/src/dave/libdave.ts) requires `libdave.js` and `libdave.wasm` to exist there.

When you rotate the companion token, start a new worker process. The worker resolves the token once per job and does not re-read it during reconnects.

## CLI Contract

The public CLI surface is defined in [src/commands/play-url.ts](/Users/harrisonpope/Desktop/DiscordStream/src/commands/play-url.ts).

Command:

```bash
discord-stream play-url \
  --guild-id <snowflake> \
  --channel-id <snowflake> \
  --url <direct-mp4-or-mkv-url> \
  [--mode go-live] \
  [--json]
```

Facts:

- `--guild-id` must be a Discord snowflake
- `--channel-id` must be a Discord snowflake
- `--url` must resolve to a direct `.mp4` or `.mkv`
- `--mode` only accepts `go-live`
- `--json` is accepted for compatibility, but lifecycle output is always JSON lines

## Lifecycle Output

Lifecycle events are emitted by [src/lifecycle.ts](/Users/harrisonpope/Desktop/DiscordStream/src/lifecycle.ts) to `stdout`.

Event sequence:

- `authenticating`
- `resolved_media`
- `joining_voice`
- `starting_stream`
- `completed`
- `failed`

Example success:

```json
{"event":"authenticating","timestamp":"2026-03-11T18:00:00.000Z","details":{"guildId":"123","channelId":"456","mode":"go-live"}}
{"event":"resolved_media","timestamp":"2026-03-11T18:00:01.000Z","details":{"url":"https://example.com/video.mp4","streamCount":2}}
{"event":"joining_voice","timestamp":"2026-03-11T18:00:02.000Z","details":{"guildId":"123","channelId":"456","userId":"789"}}
{"event":"starting_stream","timestamp":"2026-03-11T18:00:03.000Z","details":{"url":"https://example.com/video.mp4","mode":"go-live"}}
{"event":"completed","timestamp":"2026-03-11T18:05:03.000Z","details":{"guildId":"123","channelId":"456"}}
```

Example failure:

```json
{"event":"failed","timestamp":"2026-03-11T18:00:03.000Z","details":{"message":"Timed out waiting for Discord to complete the voice join handshake.","exitCode":30,"reason":"join_timeout_missing_voice_server"}}
```

`stderr` is reserved for logs. Treat it as diagnostics, not part of the stable machine contract.

## Exit Codes

From [src/errors.ts](/Users/harrisonpope/Desktop/DiscordStream/src/errors.ts):

- `0` success
- `10` configuration failure
- `20` authentication failure
- `30` Discord gateway / voice / stream signaling failure
- `40` media validation or transcoding failure
- `50` DAVE failure
- `60` RTP / WebRTC transport failure
- `70` unexpected internal failure

## Media Pipeline

The media path is orchestrated in [src/runtime/run-stream-job.ts](/Users/harrisonpope/Desktop/DiscordStream/src/runtime/run-stream-job.ts).

Current behavior:

- Validates the URL before authenticating
- Probes streams with `ffprobe`
- Selects a `TranscodePlan`
- Spawns `ffmpeg` into a NUT stream
- Plays audio/video through the existing voice + stream transport

Current low-CPU defaults:

- Copy video when the source is already `H264`, `<=720p`, and `<=24fps`
- Copy audio when the source is already `Opus`, `48kHz`, and `<=2` channels
- Otherwise transcode to:
  - `H264`
  - `720p`
  - `24fps`
  - `libx264 superfast`
  - `zerolatency`
  - target `1800k`
  - max `3500k`
  - video encode threads capped at `2`

Relevant files:

- [src/media/transcode-plan.ts](/Users/harrisonpope/Desktop/DiscordStream/src/media/transcode-plan.ts)
- [src/media/ffmpeg.ts](/Users/harrisonpope/Desktop/DiscordStream/src/media/ffmpeg.ts)
- [src/media/ffprobe.ts](/Users/harrisonpope/Desktop/DiscordStream/src/media/ffprobe.ts)
- [src/media/play-stream.ts](/Users/harrisonpope/Desktop/DiscordStream/src/media/play-stream.ts)
- [src/media/pipeline-stats.ts](/Users/harrisonpope/Desktop/DiscordStream/src/media/pipeline-stats.ts)

## Discord Protocol Model

The runtime uses a custom user gateway session rather than `discord.js-selfbot-v13`.

### Main gateway

Implemented in [src/discord/user-gateway-session.ts](/Users/harrisonpope/Desktop/DiscordStream/src/discord/user-gateway-session.ts):

- Gateway version `9`
- Desktop-style Identify payload
- nonzero capabilities value aligned with the documented example
- heartbeat scheduling plus immediate response to gateway heartbeat requests
- sequence tracking
- Resume vs re-Identify close-code handling
- guild/channel cache for preflight diagnostics

### Voice join

Implemented in [src/discord/join/voice-join-coordinator.ts](/Users/harrisonpope/Desktop/DiscordStream/src/discord/join/voice-join-coordinator.ts):

- sends `VOICE_STATE_UPDATE`
- waits for both `VOICE_STATE_UPDATE` and `VOICE_SERVER_UPDATE`
- preserves partial handshake state across retries
- distinguishes:
  - `join_timeout_no_gateway_response`
  - `join_timeout_missing_voice_state`
  - `join_timeout_missing_voice_server`
- treats `VOICE_SERVER_UPDATE.endpoint = null` as temporary reallocation

### Stream join

Implemented in [src/discord/join/stream-join-coordinator.ts](/Users/harrisonpope/Desktop/DiscordStream/src/discord/join/stream-join-coordinator.ts):

- sends `STREAM_CREATE`
- waits for both `STREAM_CREATE` and `STREAM_SERVER_UPDATE`
- stops retrying immediately on `STREAM_DELETE`
- surfaces `stream_delete:<reason>`

### Voice and stream websockets

Implemented in [src/discord/voice/base-media-connection.ts](/Users/harrisonpope/Desktop/DiscordStream/src/discord/voice/base-media-connection.ts):

- voice gateway `v=9`
- `channel_id` included on voice Identify and Resume
- heartbeat timer plus immediate response to voice heartbeat requests
- DAVE negotiation through `DaveSessionManager`
- WebRTC renegotiation support

### Runtime recovery

Orchestrated in [src/discord/streamer.ts](/Users/harrisonpope/Desktop/DiscordStream/src/discord/streamer.ts):

- bounded runtime recovery attempts
- long-lived routing for `VOICE_*` and `STREAM_*` gateway updates
- refreshes live connections when Discord rotates tokens or endpoints
- keeps the high-level media pipeline object stable during reconnect windows

## Code Map

If you need to change behavior, start here:

- [src/cli.ts](/Users/harrisonpope/Desktop/DiscordStream/src/cli.ts): top-level CLI
- [src/runtime/run-stream-job.ts](/Users/harrisonpope/Desktop/DiscordStream/src/runtime/run-stream-job.ts): one-shot job orchestration
- [src/discord/user-gateway-session.ts](/Users/harrisonpope/Desktop/DiscordStream/src/discord/user-gateway-session.ts): user gateway session
- [src/discord/streamer.ts](/Users/harrisonpope/Desktop/DiscordStream/src/discord/streamer.ts): voice + stream orchestration
- [src/discord/join/voice-join-coordinator.ts](/Users/harrisonpope/Desktop/DiscordStream/src/discord/join/voice-join-coordinator.ts): initial and refresh voice join
- [src/discord/join/stream-join-coordinator.ts](/Users/harrisonpope/Desktop/DiscordStream/src/discord/join/stream-join-coordinator.ts): initial and refresh stream join
- [src/discord/voice/base-media-connection.ts](/Users/harrisonpope/Desktop/DiscordStream/src/discord/voice/base-media-connection.ts): voice websocket, DAVE, WebRTC
- [src/dave/session-manager.ts](/Users/harrisonpope/Desktop/DiscordStream/src/dave/session-manager.ts): DAVE session manager
- [src/transport/webrtc-connection.ts](/Users/harrisonpope/Desktop/DiscordStream/src/transport/webrtc-connection.ts): RTP / peer connection wrapper

## Operational Guardrails For Agents

- Do not try to extract or generate a Discord user token. The runtime assumes the token already exists.
- Do not feed webpage URLs, magnet links, or manifests into `--url`.
- Do not assume bot tokens are supported; the runtime rejects them explicitly.
- Do not reuse a worker process for multiple stream jobs.
- Always watch `stderr` when debugging join failures. `stdout` alone is too coarse.
- If the first join fails, inspect `details.reason` from the `failed` event before changing code.

## Verification Status

Re-verified locally on March 11, 2026:

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`

Also re-audited the main gateway and voice join path against:

- [Discord API docs](https://docs.discord.food/topics/gateway)
- [Discord voice connection docs](https://docs.discord.food/topics/voice-connections)

What is still outside local verification:

- A live Discord E2E stream with a real companion token and private guild
- Docker image execution against a real voice channel after these latest gateway fixes

## Related Docs

- [docs/agent-runbook.md](/Users/harrisonpope/Desktop/DiscordStream/docs/agent-runbook.md)
- [docs/architecture.md](/Users/harrisonpope/Desktop/DiscordStream/docs/architecture.md)
- [docs/cli-contract.md](/Users/harrisonpope/Desktop/DiscordStream/docs/cli-contract.md)
- [docs/dave-notes.md](/Users/harrisonpope/Desktop/DiscordStream/docs/dave-notes.md)
- [docs/ops.md](/Users/harrisonpope/Desktop/DiscordStream/docs/ops.md)
- [docs/adr/0001-companion-user-client.md](/Users/harrisonpope/Desktop/DiscordStream/docs/adr/0001-companion-user-client.md)
