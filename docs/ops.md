# Ops Notes

## Required Environment

- `DISCORD_COMPANION_TOKEN`
- `LOG_LEVEL`
- optional `FFMPEG_PATH`
- optional `FFPROBE_PATH`

## Packaging

The supported deployment target is Linux `x86_64` via Docker.

- The Docker build compiles `libdave` WASM from the official source.
- Runtime images expect `vendor/libdave/libdave.js` and `vendor/libdave/libdave.wasm`.

Build and run:

```bash
docker build -t discord-stream:local .
docker run --rm \
  --env-file .env \
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

- Authentication failures typically mean the companion token is invalid or Discord exposed a bot identity.
- Gateway failures now include explicit join reason codes such as `join_timeout_no_gateway_response`, `join_timeout_missing_voice_state`, `join_timeout_missing_voice_server`, and `stream_delete:*`.
- DAVE failures usually mean missing `libdave` artifacts or voice-gateway negotiation problems.
- Transport failures typically happen when WebRTC negotiation or RTP packetization fails.
- Media failures usually mean the URL is not a direct file URL or the host blocked `HEAD` and range requests.

## Discord Session Model

- The worker now opens and maintains its own Discord user gateway websocket.
- Voice join waits for both `VOICE_STATE_UPDATE` and `VOICE_SERVER_UPDATE`.
- Go Live creation waits for both `STREAM_CREATE` and `STREAM_SERVER_UPDATE`.
- Runtime disconnect recovery replays the documented handshakes instead of only retrying the voice websocket.

## Operational Procedure

1. Ensure `DISCORD_COMPANION_TOKEN` is present.
2. Build the image.
3. Start one container per stream job.
4. Parse lifecycle JSON from `stdout`.
5. On user cancellation, send `SIGTERM` to the container or process.
6. Do not attempt to reuse a completed container for another job.

## Operational Warning

This app intentionally uses a separate companion user client because v1 does not assume Discord bot-token video streaming is available. That is an operational and policy risk that must be managed by the operator.
