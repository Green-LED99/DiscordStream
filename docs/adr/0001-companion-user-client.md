# ADR 0001: Companion User Client For Streaming

## Status

Accepted.

## Context

The command surface lives in an AI Discord bot, but the streaming worker needs to send Go Live video into a Discord voice session with DAVE enabled.

Available references show:

- official DAVE protocol and `libdave` support
- official bot voice libraries that remain audio-focused
- community implementations that explicitly require a self client for video streaming

## Decision

Use a separate companion Discord user client for the media worker.

## Consequences

- Chat automation and media streaming are isolated identities.
- The streamer can target current Discord video transport behavior without assuming bot-token video support.
- Operators must manage a dedicated companion token and accept the associated risk profile.

