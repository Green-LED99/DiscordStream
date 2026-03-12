import { beforeEach, describe, expect, test, vi } from 'vitest';
import { VoiceJoinCoordinator } from '../src/discord/join/voice-join-coordinator.js';
import { Logger } from '../src/logging.js';

function createSession() {
  return {
    sendGatewayOpcode: vi.fn(),
  };
}

function createConnection() {
  return {
    setReconnectAttempt: vi.fn(),
    prepareForReconnect: vi.fn(),
    setSession: vi.fn(),
    setTokens: vi.fn(),
    waitUntilReady: vi.fn(async () => ({ mediaConnection: 'voice' })),
  };
}

describe('VoiceJoinCoordinator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test('connects when voice state arrives before voice server', async () => {
    const session = createSession();
    const connection = createConnection();
    const coordinator = new VoiceJoinCoordinator(
      session as never,
      connection as never,
      new Logger('test', 'debug'),
      'guild-1',
      'channel-1',
      { handshakeTimeoutMs: 25 }
    );

    const promise = coordinator.connectInitial();
    await Promise.resolve();

    coordinator.handleVoiceStateUpdate({
      t: 'VOICE_STATE_UPDATE',
      d: {
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        user_id: 'user-1',
        session_id: 'voice-session',
      },
    });
    coordinator.handleVoiceServerUpdate({
      t: 'VOICE_SERVER_UPDATE',
      d: {
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        endpoint: 'voice.discord.test',
        token: 'voice-token',
      },
    });

    await expect(promise).resolves.toEqual({ mediaConnection: 'voice' });
    expect(connection.prepareForReconnect).toHaveBeenCalledWith(1);
    expect(connection.setSession).toHaveBeenCalledWith('voice-session');
    expect(connection.setTokens).toHaveBeenCalledWith('voice.discord.test', 'voice-token');
  });

  test('connects when voice server arrives before voice state', async () => {
    const session = createSession();
    const connection = createConnection();
    const coordinator = new VoiceJoinCoordinator(
      session as never,
      connection as never,
      new Logger('test', 'debug'),
      'guild-1',
      'channel-1',
      { handshakeTimeoutMs: 25 }
    );

    const promise = coordinator.connectInitial();
    await Promise.resolve();

    coordinator.handleVoiceServerUpdate({
      t: 'VOICE_SERVER_UPDATE',
      d: {
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        endpoint: 'voice.discord.test',
        token: 'voice-token',
      },
    });
    coordinator.handleVoiceStateUpdate({
      t: 'VOICE_STATE_UPDATE',
      d: {
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        user_id: 'user-1',
        session_id: 'voice-session',
      },
    });

    await expect(promise).resolves.toEqual({ mediaConnection: 'voice' });
    expect(connection.prepareForReconnect).toHaveBeenCalledWith(1);
  });

  test('preserves a partial voice state across retries', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const session = createSession();
    const connection = createConnection();
    const coordinator = new VoiceJoinCoordinator(
      session as never,
      connection as never,
      new Logger('test', 'debug'),
      'guild-1',
      'channel-1',
      { initialAttempts: 2, handshakeTimeoutMs: 25 }
    );

    const promise = coordinator.connectInitial();
    await Promise.resolve();

    coordinator.handleVoiceStateUpdate({
      t: 'VOICE_STATE_UPDATE',
      d: {
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        user_id: 'user-1',
        session_id: 'voice-session',
      },
    });

    await vi.advanceTimersByTimeAsync(275);
    coordinator.handleVoiceServerUpdate({
      t: 'VOICE_SERVER_UPDATE',
      d: {
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        endpoint: 'voice.discord.test',
        token: 'voice-token',
      },
    });

    await expect(promise).resolves.toEqual({ mediaConnection: 'voice' });
    expect(session.sendGatewayOpcode).toHaveBeenCalledTimes(2);
    expect(connection.setSession).toHaveBeenCalledWith('voice-session');

    vi.useRealTimers();
  });

  test('classifies a no-response timeout', async () => {
    vi.useFakeTimers();

    const session = createSession();
    const connection = createConnection();
    const coordinator = new VoiceJoinCoordinator(
      session as never,
      connection as never,
      new Logger('test', 'debug'),
      'guild-1',
      'channel-1',
      { initialAttempts: 1, handshakeTimeoutMs: 25 }
    );

    const promise = coordinator.connectInitial();
    const rejection = expect(promise).rejects.toMatchObject({
      details: expect.objectContaining({
        reason: 'join_timeout_no_gateway_response',
      }),
    });
    await vi.advanceTimersByTimeAsync(25);

    await rejection;

    vi.useRealTimers();
  });

  test('waits for a replacement endpoint after a null voice server update', async () => {
    const session = createSession();
    const connection = createConnection();
    const coordinator = new VoiceJoinCoordinator(
      session as never,
      connection as never,
      new Logger('test', 'debug'),
      'guild-1',
      'channel-1',
      { handshakeTimeoutMs: 25 }
    );

    const promise = coordinator.connectInitial();
    await Promise.resolve();

    coordinator.handleVoiceServerUpdate({
      t: 'VOICE_SERVER_UPDATE',
      d: {
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        endpoint: null,
        token: 'stale-token',
      },
    });
    coordinator.handleVoiceStateUpdate({
      t: 'VOICE_STATE_UPDATE',
      d: {
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        user_id: 'user-1',
        session_id: 'voice-session',
      },
    });
    coordinator.handleVoiceServerUpdate({
      t: 'VOICE_SERVER_UPDATE',
      d: {
        guild_id: 'guild-1',
        channel_id: 'channel-1',
        endpoint: 'voice.discord.test',
        token: 'voice-token',
      },
    });

    await expect(promise).resolves.toEqual({ mediaConnection: 'voice' });
    expect(connection.setTokens).toHaveBeenCalledWith('voice.discord.test', 'voice-token');
  });
});
