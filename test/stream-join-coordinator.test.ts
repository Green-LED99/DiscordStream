import { beforeEach, describe, expect, test, vi } from 'vitest';
import { StreamJoinCoordinator } from '../src/discord/join/stream-join-coordinator.js';
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
    setStreamContext: vi.fn(),
    setSession: vi.fn(),
    setTokens: vi.fn(),
    waitUntilReady: vi.fn(async () => ({ mediaConnection: 'stream' })),
  };
}

describe('StreamJoinCoordinator', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test('connects after stream create and stream server update arrive', async () => {
    const session = createSession();
    const connection = createConnection();
    const coordinator = new StreamJoinCoordinator(
      session as never,
      connection as never,
      new Logger('test', 'debug'),
      'guild-1',
      'channel-1',
      'user-1',
      () => 'voice-session',
      { handshakeTimeoutMs: 25 }
    );

    const promise = coordinator.connectInitial();
    await Promise.resolve();

    coordinator.handleStreamCreate({
      t: 'STREAM_CREATE',
      d: {
        stream_key: 'guild:guild-1:channel-1:user-1',
        rtc_server_id: '777',
      },
    });
    coordinator.handleStreamServerUpdate({
      t: 'STREAM_SERVER_UPDATE',
      d: {
        stream_key: 'guild:guild-1:channel-1:user-1',
        endpoint: 'stream.discord.test',
        token: 'stream-token',
      },
    });

    await expect(promise).resolves.toEqual({ mediaConnection: 'stream' });
    expect(connection.setStreamContext).toHaveBeenCalledWith(
      '777',
      'guild:guild-1:channel-1:user-1'
    );
    expect(connection.setSession).toHaveBeenCalledWith('voice-session');
    expect(connection.setTokens).toHaveBeenCalledWith('stream.discord.test', 'stream-token');
  });

  test('surfaces stream_delete reasons during stream creation', async () => {
    const session = createSession();
    const connection = createConnection();
    const coordinator = new StreamJoinCoordinator(
      session as never,
      connection as never,
      new Logger('test', 'debug'),
      'guild-1',
      'channel-1',
      'user-1',
      () => 'voice-session',
      { handshakeTimeoutMs: 25 }
    );

    const promise = coordinator.connectInitial();
    await Promise.resolve();

    coordinator.handleStreamDelete({
      t: 'STREAM_DELETE',
      d: {
        stream_key: 'guild:guild-1:channel-1:user-1',
        reason: 'stream_full',
      },
    });

    await expect(promise).rejects.toMatchObject({
      details: expect.objectContaining({
        reason: 'stream_delete:stream_full',
      }),
    });
  });
});
