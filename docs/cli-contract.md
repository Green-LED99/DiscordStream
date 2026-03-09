# CLI Contract

## Command

```bash
discord-stream play-url \
  --guild-id <snowflake> \
  --channel-id <snowflake> \
  --url <https://...mp4|mkv> \
  [--mode go-live] \
  [--json]
```

## Supported Input

- `--guild-id`: required guild snowflake
- `--channel-id`: required voice channel snowflake
- `--url`: required direct `http` or `https` media URL with `.mp4` or `.mkv` path
- `--mode`: only `go-live` is supported in v1
- `--json`: accepted for compatibility; lifecycle output is always JSON lines

The worker is intentionally strict. If the URL is not obviously a direct file URL, reject it before calling the process.

## Stdout

Stdout is reserved for lifecycle events:

```json
{"event":"authenticating","timestamp":"...","details":{"guildId":"...","channelId":"...","mode":"go-live"}}
{"event":"resolved_media","timestamp":"...","details":{"url":"https://...","streamCount":2}}
{"event":"joining_voice","timestamp":"...","details":{"guildId":"...","channelId":"...","userId":"..."}}
{"event":"starting_stream","timestamp":"...","details":{"url":"https://...","mode":"go-live"}}
{"event":"completed","timestamp":"...","details":{"guildId":"...","channelId":"..."}}
```

On failure:

```json
{"event":"failed","timestamp":"...","details":{"message":"...","exitCode":40}}
```

## Event Meanings

- `authenticating`: config loaded and the worker is starting Discord login
- `resolved_media`: the media URL was accepted and `ffprobe` returned stream metadata
- `joining_voice`: the companion user is authenticated and the worker is joining voice
- `starting_stream`: the worker has a voice transport and has started feeding `ffmpeg` output into the transport
- `completed`: the stream finished cleanly
- `failed`: the worker hit a terminal error and will exit non-zero

## Stderr

Structured logs are written to `stderr` as JSON lines. Consumers should not parse `stderr` as the stable API surface.

## Process Lifetime

- One process handles one stream job.
- The process should be terminated with `SIGTERM` for user-requested cancellation.
- `SIGINT` and `SIGTERM` both trigger abort, voice leave, and client teardown.

## Exit Codes

- `0`: success
- `10`: configuration
- `20`: authentication
- `30`: Discord gateway / voice signaling
- `40`: media validation / ffprobe / ffmpeg
- `50`: DAVE failure
- `60`: transport failure
- `70`: internal failure
