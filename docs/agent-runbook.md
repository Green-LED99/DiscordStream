# Agent Runbook

## Use This First

This app is a one-shot worker. Start a fresh process for each stream request. Do not keep it alive for multiple jobs.

## What The Worker Accepts

- A guild id
- A voice channel id
- A direct `http` or `https` URL ending in `.mp4` or `.mkv`
- Optional `--mode go-live`
- Optional `--json`

Only direct file URLs are in scope. Reject YouTube pages, HLS manifests, generic webpages, and bot tokens.

## Required Environment

- `DISCORD_COMPANION_TOKEN`
- `LOG_LEVEL`
- Optional `FFMPEG_PATH`
- Optional `FFPROBE_PATH`

The token must belong to a companion user account. If Discord exposes the identity as a bot user, the process exits with code `20`.

## Fastest Invocation Paths

### Local Node

```bash
npm install
npm run build:libdave
npm run build
node dist/src/cli.js play-url \
  --guild-id 123 \
  --channel-id 456 \
  --url https://example.com/video.mp4 \
  --json
```

### Docker

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

## Stdout And Stderr Rules

- `stdout` is reserved for lifecycle events as JSON lines.
- `stderr` is reserved for structured logs as JSON lines.
- Parse `stdout` only for job state.
- Preserve `stderr` for debugging, but do not treat it as the contract surface.

Expected lifecycle events:

- `authenticating`
- `resolved_media`
- `joining_voice`
- `starting_stream`
- `completed`
- `failed`

## Exit Codes

- `0`: success
- `10`: configuration
- `20`: authentication
- `30`: Discord gateway or voice signaling
- `40`: media validation, `ffprobe`, or `ffmpeg`
- `50`: DAVE
- `60`: transport
- `70`: internal failure

## Recommended Agent Flow

1. Validate that the requested URL is a direct `.mp4` or `.mkv` link before invoking the worker.
2. Start one worker process for one stream request.
3. Read `stdout` line by line and parse JSON.
4. If a `failed` event arrives, stop waiting and surface `details.message` plus `details.exitCode`.
5. If the process exits with `0`, treat the stream as completed.
6. If the user cancels, send `SIGTERM` and wait for process exit.

## Example Host Wrapper

```ts
import { spawn } from 'node:child_process';
import readline from 'node:readline';

const child = spawn('node', [
  'dist/src/cli.js',
  'play-url',
  '--guild-id', guildId,
  '--channel-id', channelId,
  '--url', mediaUrl,
  '--json',
], {
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
});

const stdout = readline.createInterface({ input: child.stdout });
stdout.on('line', (line) => {
  const event = JSON.parse(line);
  handleLifecycleEvent(event);
});

function stopStream() {
  child.kill('SIGTERM');
}
```

## Build And Runtime Assumptions

- Supported deployment target: Linux `x86_64` Docker image.
- Default transcode profile: `H.264 + Opus`, `720p30`.
- DAVE is attempted first. If Discord negotiates protocol version `0`, the worker downgrades to passthrough mode.
- The worker exits after stream completion, failure, or signal-triggered shutdown.

## When Not To Use This Worker

- The media URL is not direct file media.
- The caller only has a bot token.
- The target is a DM or GDM call.
- The target is Stage Channels, camera mode, or a generic webpage stream.

## Where To Look In The Code

- `src/cli.ts`: CLI surface
- `src/runtime/run-stream-job.ts`: job orchestration and cleanup
- `src/dave/session-manager.ts`: DAVE MLS session flow
- `src/media/play-stream.ts`: ffmpeg output handling and pacing
- `src/transport/webrtc-connection.ts`: RTP packetization and WebRTC transport
