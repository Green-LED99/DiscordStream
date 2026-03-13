import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Logger } from '../src/logging.js';

class MockConnection extends EventEmitter {
  public readonly setReconnectAttempt = vi.fn();
  public readonly prepareForReconnect = vi.fn();
  public readonly prepareForServerReallocation = vi.fn();
  public waitUntilReady = vi.fn();
  public readonly setSession = vi.fn((sessionId: string) => {
    this.voiceSessionId = sessionId;
  });
  public readonly setTokens = vi.fn();
  public readonly setStreamContext = vi.fn();
  public readonly stop = vi.fn();
  public readonly setSpeaking = vi.fn();
  public readonly setVideoAttributes = vi.fn();
  public readonly webRtcConn = { mediaConnection: this } as const;
  public voiceSessionId: string | null = 'session-1';
  public isReady = false;

  public constructor(
    public readonly connectionKind: 'voice' | 'stream',
    public readonly guildId: string | null,
    public readonly channelId: string
  ) {
    super();
  }
}

let nextVoiceConnection: MockConnection;
let nextStreamConnection: MockConnection;
let voiceWaitUntilReadyMock: ReturnType<typeof vi.fn>;
let streamWaitUntilReadyMock: ReturnType<typeof vi.fn>;
let lastVoiceTransientKeys: unknown;
let lastStreamTransientKeys: unknown;

vi.mock('../src/discord/voice/voice-connection.js', () => ({
  VoiceConnection: vi.fn(
    (
      _streamer,
      _dave,
      _logger,
      guildId: string | null,
      _userId: string,
      channelId: string,
      transientKeys: unknown
    ) => {
      lastVoiceTransientKeys = transientKeys;
      nextVoiceConnection = new MockConnection('voice', guildId, channelId);
      nextVoiceConnection.waitUntilReady = voiceWaitUntilReadyMock;
      return nextVoiceConnection;
    }
  ),
}));

vi.mock('../src/discord/voice/stream-connection.js', () => ({
  StreamConnection: vi.fn(
    (
      _streamer,
      _dave,
      _logger,
      guildId: string | null,
      _userId: string,
      channelId: string,
      transientKeys: unknown
    ) => {
      lastStreamTransientKeys = transientKeys;
      nextStreamConnection = new MockConnection('stream', guildId, channelId);
      nextStreamConnection.waitUntilReady = streamWaitUntilReadyMock;
      return nextStreamConnection;
    }
  ),
}));

function createSession() {
  let rawListener:
    | ((event: {
        t:
          | 'VOICE_STATE_UPDATE'
          | 'VOICE_SERVER_UPDATE'
          | 'STREAM_CREATE'
          | 'STREAM_SERVER_UPDATE'
          | 'STREAM_DELETE';
        d: Record<string, unknown>;
      }) => void)
    | null = null;

  return {
    destroy: vi.fn(),
    onRaw: vi.fn((listener) => {
      rawListener = listener;
    }),
    offRaw: vi.fn(),
    sendGatewayOpcode: vi.fn(),
    currentUser: vi.fn(() => ({ id: 'user-1' })),
    preflightVoiceJoin: vi.fn(async () => ({
      channelType: 2,
      warnings: [],
      permissions: { connect: true, stream: true },
      occupancy: { connectedUsers: 0, userLimit: 0, maxVideoChannelUsers: 25 },
    })),
    emitRaw(event: {
      t:
        | 'VOICE_STATE_UPDATE'
        | 'VOICE_SERVER_UPDATE'
        | 'STREAM_CREATE'
        | 'STREAM_SERVER_UPDATE'
        | 'STREAM_DELETE';
      d: Record<string, unknown>;
    }) {
      rawListener?.(event);
    },
  };
}

function createDaveModule() {
  class FakeTransientKeys {
    public Clear(): void {}
  }

  return {
    TransientKeys: FakeTransientKeys,
  };
}

describe('Streamer', () => {
  beforeEach(() => {
    vi.resetModules();
    lastVoiceTransientKeys = undefined;
    lastStreamTransientKeys = undefined;
    voiceWaitUntilReadyMock = vi.fn(async () => {
      nextVoiceConnection.isReady = true;
      return { mediaConnection: nextVoiceConnection };
    });
    streamWaitUntilReadyMock = vi.fn(async () => {
      nextStreamConnection.isReady = true;
      return { mediaConnection: nextStreamConnection };
    });
  });

  test('joins voice only after both handshake events arrive', async () => {
    const session = createSession();

    const { Streamer } = await import('../src/discord/streamer.js');
    const streamer = new Streamer(
      session as never,
      createDaveModule() as never,
      new Logger('test', 'debug')
    );

    const joinPromise = streamer.joinVoice('guild-1', 'channel-1');
    await Promise.resolve();

    expect(session.preflightVoiceJoin).toHaveBeenCalledWith('guild-1', 'channel-1');
    expect(session.sendGatewayOpcode).toHaveBeenCalledWith(4, expect.any(Object));

    session.emitRaw({
      t: 'VOICE_SERVER_UPDATE',
      d: {
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        endpoint: 'voice.discord.test',
        token: 'voice-token',
      },
    });
    session.emitRaw({
      t: 'VOICE_STATE_UPDATE',
      d: {
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        user_id: 'user-1',
        session_id: 'voice-session',
      },
    });

    const result = await joinPromise;
    expect(result).toEqual({ mediaConnection: nextVoiceConnection });
    expect(nextVoiceConnection.prepareForReconnect).toHaveBeenCalledWith(1);
    expect(nextVoiceConnection.setSession).toHaveBeenCalledWith('voice-session');
    expect(nextVoiceConnection.setTokens).toHaveBeenCalledWith('voice.discord.test', 'voice-token');
  });

  test('reissues voice and stream requests during runtime recovery', async () => {
    const session = createSession();

    const { Streamer } = await import('../src/discord/streamer.js');
    const streamer = new Streamer(
      session as never,
      createDaveModule() as never,
      new Logger('test', 'debug')
    );

    const joinPromise = streamer.joinVoice('guild-1', 'channel-1');
    await Promise.resolve();
    session.emitRaw({
      t: 'VOICE_STATE_UPDATE',
      d: {
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        user_id: 'user-1',
        session_id: 'voice-session',
      },
    });
    session.emitRaw({
      t: 'VOICE_SERVER_UPDATE',
      d: {
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        endpoint: 'voice.discord.test',
        token: 'voice-token',
      },
    });
    await joinPromise;

    const streamPromise = streamer.createStream();
    await Promise.resolve();
    session.emitRaw({
      t: 'STREAM_CREATE',
      d: {
        stream_key: 'guild:guild-1:channel-1:user-1',
        rtc_server_id: '777',
        rtc_channel_id: '999',
      },
    });
    session.emitRaw({
      t: 'STREAM_SERVER_UPDATE',
      d: {
        stream_key: 'guild:guild-1:channel-1:user-1',
        endpoint: 'stream.discord.test',
        token: 'stream-token',
      },
    });
    await streamPromise;

    session.sendGatewayOpcode.mockClear();

    streamer.handleConnectionRecoveryRequested(nextVoiceConnection as never, {
      connectionKind: 'voice',
      attempt: 0,
      trigger: 'socket_close',
      state: 'refreshing',
      closeCode: 4014,
    });

    await Promise.resolve();
    session.emitRaw({
      t: 'VOICE_SERVER_UPDATE',
      d: {
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        endpoint: 'voice.discord.test',
        token: 'voice-token-2',
      },
    });
    session.emitRaw({
      t: 'VOICE_STATE_UPDATE',
      d: {
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        user_id: 'user-1',
        session_id: 'voice-session-2',
      },
    });
    session.emitRaw({
      t: 'STREAM_CREATE',
      d: {
        stream_key: 'guild:guild-1:channel-1:user-1',
        rtc_server_id: '888',
        rtc_channel_id: '1000',
      },
    });
    session.emitRaw({
      t: 'STREAM_SERVER_UPDATE',
      d: {
        stream_key: 'guild:guild-1:channel-1:user-1',
        endpoint: 'stream.discord.test',
        token: 'stream-token-2',
      },
    });

    expect(nextVoiceConnection.prepareForReconnect).toHaveBeenCalledWith(1);
    expect(nextStreamConnection.prepareForReconnect).toHaveBeenCalledWith(1);
    await vi.waitFor(() => {
      expect(session.sendGatewayOpcode).toHaveBeenCalledWith(4, expect.any(Object));
      expect(session.sendGatewayOpcode).toHaveBeenCalledWith(18, expect.any(Object));
      expect(session.sendGatewayOpcode).toHaveBeenCalledWith(22, expect.any(Object));
    });
  });

  test('ignores non-target voice state updates before the initial join is ready', async () => {
    const session = createSession();

    const { Streamer } = await import('../src/discord/streamer.js');
    const streamer = new Streamer(
      session as never,
      createDaveModule() as never,
      new Logger('test', 'debug')
    );

    const joinPromise = streamer.joinVoice('guild-1', 'channel-1');
    await Promise.resolve();

    session.emitRaw({
      t: 'VOICE_STATE_UPDATE',
      d: {
        user_id: 'user-1',
        session_id: 'session-null',
        guild_id: 'guild-1',
        channel_id: null,
      },
    });
    await Promise.resolve();

    expect(nextVoiceConnection.prepareForReconnect).toHaveBeenCalledTimes(0);
    expect(nextVoiceConnection.setSession).not.toHaveBeenCalledWith('session-null');

    session.emitRaw({
      t: 'VOICE_STATE_UPDATE',
      d: {
        user_id: 'user-1',
        session_id: 'voice-session',
        guild_id: 'guild-1',
        channel_id: 'channel-1',
      },
    });
    session.emitRaw({
      t: 'VOICE_SERVER_UPDATE',
      d: {
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        endpoint: 'voice.discord.test',
        token: 'voice-token',
      },
    });

    await joinPromise;
  });

  test('leaves voice with the active guild id', async () => {
    const session = createSession();

    const { Streamer } = await import('../src/discord/streamer.js');
    const streamer = new Streamer(
      session as never,
      createDaveModule() as never,
      new Logger('test', 'debug')
    );

    const joinPromise = streamer.joinVoice('guild-1', 'channel-1');
    await Promise.resolve();

    session.emitRaw({
      t: 'VOICE_STATE_UPDATE',
      d: {
        user_id: 'user-1',
        session_id: 'voice-session',
        guild_id: 'guild-1',
        channel_id: 'channel-1',
      },
    });
    session.emitRaw({
      t: 'VOICE_SERVER_UPDATE',
      d: {
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        endpoint: 'voice.discord.test',
        token: 'voice-token',
      },
    });
    await joinPromise;

    session.sendGatewayOpcode.mockClear();
    streamer.leaveVoice();

    expect(session.sendGatewayOpcode).toHaveBeenCalledWith(4, {
      guild_id: 'guild-1',
      channel_id: null,
      self_mute: true,
      self_deaf: false,
      self_video: false,
    });
  });

  test('treats a post-ready voice channel removal as fatal instead of reconnecting', async () => {
    const session = createSession();
    const fatalListener = vi.fn();

    const { Streamer } = await import('../src/discord/streamer.js');
    const streamer = new Streamer(
      session as never,
      createDaveModule() as never,
      new Logger('test', 'debug')
    );
    streamer.onFatal(fatalListener);

    const joinPromise = streamer.joinVoice('guild-1', 'channel-1');
    await Promise.resolve();

    session.emitRaw({
      t: 'VOICE_STATE_UPDATE',
      d: {
        user_id: 'user-1',
        session_id: 'voice-session',
        guild_id: 'guild-1',
        channel_id: 'channel-1',
      },
    });
    session.emitRaw({
      t: 'VOICE_SERVER_UPDATE',
      d: {
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        endpoint: 'voice.discord.test',
        token: 'voice-token',
      },
    });
    await joinPromise;

    session.emitRaw({
      t: 'VOICE_STATE_UPDATE',
      d: {
        user_id: 'user-1',
        session_id: 'voice-session-2',
        guild_id: 'guild-1',
        channel_id: null,
      },
    });

    expect(nextVoiceConnection.prepareForReconnect).toHaveBeenCalledTimes(1);
    expect(fatalListener).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          reason: 'voice_state_terminal_disconnect',
          observedChannelId: null,
        }),
      })
    );
  });

  test('ignores cleared stream endpoints until Discord sends a replacement', async () => {
    const session = createSession();

    const { Streamer } = await import('../src/discord/streamer.js');
    const streamer = new Streamer(
      session as never,
      createDaveModule() as never,
      new Logger('test', 'debug')
    );

    const joinPromise = streamer.joinVoice('guild-1', 'channel-1');
    await Promise.resolve();
    session.emitRaw({
      t: 'VOICE_STATE_UPDATE',
      d: {
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        user_id: 'user-1',
        session_id: 'voice-session',
      },
    });
    session.emitRaw({
      t: 'VOICE_SERVER_UPDATE',
      d: {
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        endpoint: 'voice.discord.test',
        token: 'voice-token',
      },
    });
    await joinPromise;

    const streamPromise = streamer.createStream();
    await Promise.resolve();
    session.emitRaw({
      t: 'STREAM_CREATE',
      d: {
        stream_key: 'guild:guild-1:channel-1:user-1',
        rtc_server_id: '777',
        rtc_channel_id: '999',
      },
    });
    session.emitRaw({
      t: 'STREAM_SERVER_UPDATE',
      d: {
        stream_key: 'guild:guild-1:channel-1:user-1',
        endpoint: 'stream.discord.test',
        token: 'stream-token',
      },
    });
    await streamPromise;

    nextStreamConnection.setTokens.mockClear();

    session.emitRaw({
      t: 'STREAM_SERVER_UPDATE',
      d: {
        stream_key: 'guild:guild-1:channel-1:user-1',
        endpoint: null,
        token: 'stale-token',
      },
    });

    expect(nextStreamConnection.prepareForServerReallocation).toHaveBeenCalledTimes(1);
    expect(nextStreamConnection.setTokens).not.toHaveBeenCalled();
  });

  test('disconnects from the active voice server when Discord clears the endpoint', async () => {
    const session = createSession();

    const { Streamer } = await import('../src/discord/streamer.js');
    const streamer = new Streamer(
      session as never,
      createDaveModule() as never,
      new Logger('test', 'debug')
    );

    const joinPromise = streamer.joinVoice('guild-1', 'channel-1');
    await Promise.resolve();
    session.emitRaw({
      t: 'VOICE_STATE_UPDATE',
      d: {
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        user_id: 'user-1',
        session_id: 'voice-session',
      },
    });
    session.emitRaw({
      t: 'VOICE_SERVER_UPDATE',
      d: {
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        endpoint: 'voice.discord.test',
        token: 'voice-token',
      },
    });
    await joinPromise;

    nextVoiceConnection.setTokens.mockClear();

    session.emitRaw({
      t: 'VOICE_SERVER_UPDATE',
      d: {
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        endpoint: null,
        token: 'stale-token',
      },
    });

    expect(nextVoiceConnection.prepareForServerReallocation).toHaveBeenCalledTimes(1);
    expect(nextVoiceConnection.setTokens).not.toHaveBeenCalled();
  });

  test('recovers when Discord marks the active stream unavailable', async () => {
    const session = createSession();
    const fatalListener = vi.fn();

    const { Streamer } = await import('../src/discord/streamer.js');
    const streamer = new Streamer(
      session as never,
      createDaveModule() as never,
      new Logger('test', 'debug')
    );
    streamer.onFatal(fatalListener);

    const joinPromise = streamer.joinVoice('guild-1', 'channel-1');
    await Promise.resolve();
    session.emitRaw({
      t: 'VOICE_STATE_UPDATE',
      d: {
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        user_id: 'user-1',
        session_id: 'voice-session',
      },
    });
    session.emitRaw({
      t: 'VOICE_SERVER_UPDATE',
      d: {
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        endpoint: 'voice.discord.test',
        token: 'voice-token',
      },
    });
    await joinPromise;

    const streamPromise = streamer.createStream();
    await Promise.resolve();
    session.emitRaw({
      t: 'STREAM_CREATE',
      d: {
        stream_key: 'guild:guild-1:channel-1:user-1',
        rtc_server_id: '777',
        rtc_channel_id: '999',
      },
    });
    session.emitRaw({
      t: 'STREAM_SERVER_UPDATE',
      d: {
        stream_key: 'guild:guild-1:channel-1:user-1',
        endpoint: 'stream.discord.test',
        token: 'stream-token',
      },
    });
    await streamPromise;

    session.sendGatewayOpcode.mockClear();
    nextStreamConnection.prepareForServerReallocation.mockClear();
    nextStreamConnection.prepareForReconnect.mockClear();

    session.emitRaw({
      t: 'STREAM_DELETE',
      d: {
        stream_key: 'guild:guild-1:channel-1:user-1',
        unavailable: true,
      },
    });
    await Promise.resolve();

    session.emitRaw({
      t: 'STREAM_CREATE',
      d: {
        stream_key: 'guild:guild-1:channel-1:user-1',
        rtc_server_id: '888',
        rtc_channel_id: '1000',
      },
    });
    session.emitRaw({
      t: 'STREAM_SERVER_UPDATE',
      d: {
        stream_key: 'guild:guild-1:channel-1:user-1',
        endpoint: 'stream-recovered.discord.test',
        token: 'stream-token-2',
      },
    });
    await Promise.resolve();

    expect(nextStreamConnection.prepareForServerReallocation).toHaveBeenCalledTimes(1);
    expect(nextStreamConnection.prepareForReconnect).toHaveBeenCalledTimes(1);
    expect(session.sendGatewayOpcode).toHaveBeenCalledWith(18, {
      type: 'guild',
      guild_id: 'guild-1',
      channel_id: 'channel-1',
      preferred_region: null,
    });
    expect(session.sendGatewayOpcode).toHaveBeenCalledWith(22, {
      stream_key: 'guild:guild-1:channel-1:user-1',
      paused: false,
    });
    expect(fatalListener).not.toHaveBeenCalled();
  });

  test('shares one transient key store across the voice and stream connections', async () => {
    const session = createSession();

    const { Streamer } = await import('../src/discord/streamer.js');
    const streamer = new Streamer(
      session as never,
      createDaveModule() as never,
      new Logger('test', 'debug')
    );

    const joinPromise = streamer.joinVoice('guild-1', 'channel-1');
    await Promise.resolve();
    session.emitRaw({
      t: 'VOICE_STATE_UPDATE',
      d: {
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        user_id: 'user-1',
        session_id: 'voice-session',
      },
    });
    session.emitRaw({
      t: 'VOICE_SERVER_UPDATE',
      d: {
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        endpoint: 'voice.discord.test',
        token: 'voice-token',
      },
    });
    await joinPromise;

    const streamPromise = streamer.createStream();
    await Promise.resolve();
    session.emitRaw({
      t: 'STREAM_CREATE',
      d: {
        stream_key: 'guild:guild-1:channel-1:user-1',
        rtc_server_id: '777',
        rtc_channel_id: '999',
      },
    });
    session.emitRaw({
      t: 'STREAM_SERVER_UPDATE',
      d: {
        stream_key: 'guild:guild-1:channel-1:user-1',
        endpoint: 'stream.discord.test',
        token: 'stream-token',
      },
    });
    await streamPromise;

    expect(lastVoiceTransientKeys).toBeDefined();
    expect(lastVoiceTransientKeys).toBe(lastStreamTransientKeys);
  });
});
