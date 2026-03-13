# Ops Notes

## Required Environment

- One companion token source:
  - `DISCORD_COMPANION_TOKEN`
  - `DISCORD_COMPANION_TOKEN_FILE`
  - `DISCORD_COMPANION_TOKEN_COMMAND`
- Optional `DISCORD_COMPANION_TOKEN_PROVIDER`
- Optional `DISCORD_COMPANION_TOKEN_COMMAND_TIMEOUT_MS`
- `LOG_LEVEL`
- optional `FFMPEG_PATH`
- optional `FFPROBE_PATH`

Provider behavior:

- `env`: reads the token directly from `DISCORD_COMPANION_TOKEN`
- `file`: reads a UTF-8 token file and trims it
- `command`: executes `/bin/sh -lc` and reads trimmed `stdout`
- token resolution happens once per job, immediately before Gateway login
- if more than one source variable is present, set `DISCORD_COMPANION_TOKEN_PROVIDER` explicitly

## Packaging

The supported deployment target is Linux `x86_64` via Docker.

- The Docker build compiles `libdave` WASM from the official source.
- Runtime images expect `vendor/libdave/libdave.js` and `vendor/libdave/libdave.wasm`.

Build and run:

```bash
docker build -t discord-stream:local .
docker run --rm \
  -e DISCORD_COMPANION_TOKEN_PROVIDER=file \
  -e DISCORD_COMPANION_TOKEN_FILE=/run/secrets/discord-companion-token.txt \
  -e LOG_LEVEL=info \
  -v "$(pwd)/.secrets:/run/secrets:ro" \
  discord-stream:local \
  play-url \
  --guild-id 123 \
  --channel-id 456 \
  --url https://example.com/video.mp4 \
  --json
```

## Local Docker On macOS

This repository has been verified with:

- `docker`
- `docker buildx`
- `docker compose`
- `colima`

If `docker` is installed through Homebrew, make sure `~/.docker/config.json` includes:

```json
{
  "cliPluginsExtraDirs": [
    "/opt/homebrew/lib/docker/cli-plugins"
  ]
}
```

Then start the local daemon:

```bash
colima start --cpu 4 --memory 8 --disk 60 --runtime docker
```

Stop it when finished:

```bash
colima stop
```

## Native Dependencies

- `ffmpeg`
- `ffprobe`
- `node-av`
- `@lng2004/node-datachannel`

## Failure Modes

- Configuration failures typically mean no token source was configured, multiple token sources were configured without an explicit provider selector, or the file/command provider returned no token.
- Authentication failures typically mean the resolved companion token is invalid or Discord exposed a bot identity.
- Gateway failures now include explicit join reason codes such as `join_timeout_no_gateway_response`, `join_timeout_missing_voice_state`, `join_timeout_missing_voice_server`, and `stream_delete:*`.
- DAVE failures should be split in two buckets: missing `HEAPU8` / `wasmMemory` means the `libdave` artifact is wrong and `npm run build:libdave` / `npm run verify:libdave` must be checked first; only after the artifact shape is healthy should voice-gateway or MLS/DAVE negotiation be investigated.
- Transport failures typically happen when WebRTC negotiation or RTP packetization fails.
- Media failures usually mean the URL is not a direct file URL or the host blocked `HEAD` and range requests.

## Discord Session Model

- The worker now opens and maintains its own Discord user gateway websocket.
- Voice join waits for both `VOICE_STATE_UPDATE` and `VOICE_SERVER_UPDATE`.
- Go Live creation waits for both `STREAM_CREATE` and `STREAM_SERVER_UPDATE`.
- Runtime disconnect recovery replays the documented handshakes instead of only retrying the voice websocket.

## Operational Procedure

1. Ensure exactly one companion token source is present.
2. Build the image.
3. Start one container per stream job.
4. Parse lifecycle JSON from `stdout`.
5. On user cancellation, send `SIGTERM` to the container or process.
6. Do not attempt to reuse a completed container for another job.

## Operational Warning

This app intentionally uses a separate companion user client because v1 does not assume Discord bot-token video streaming is available. That is an operational and policy risk that must be managed by the operator.

This worker does not implement username/password login, OAuth2 bearer auth, or in-process token refresh. Rotate the token in the external source and start a new worker process to pick it up.
