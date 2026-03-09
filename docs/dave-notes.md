# DAVE Notes

## Source of Truth

This implementation follows:

- `discord/dave-protocol`
- `discord/libdave`
- the upstream TypeScript `DaveSessionManager` sample in `libdave`

## Boundaries

- `libdave` is treated as the MLS and frame-encryption authority.
- The app does not implement MLS itself.
- The app only uses the send-side encryptor path in v1. A decryptor wrapper exists for parity and future use.

## Voice Opcode Handling

- JSON opcodes:
  - `21` prepare transition
  - `22` execute transition
  - `23` ready for transition
  - `24` prepare epoch
  - `31` invalid commit/welcome
- Binary opcodes:
  - `25` external sender
  - `26` key package
  - `27` proposals
  - `28` commit/welcome
  - `29` announce commit transition
  - `30` welcome

## Important Implementation Choices

- The official `libdave` `ProcessProposals` path expects the payload beginning at the revoke/append flag, so the binary handler passes bytes from offset `3` onward for opcode `27`.
- The sender-side encryptor is updated only from the local user's ratchet.
- If Discord negotiates protocol version `0`, the encryptor switches to passthrough mode.

