import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { AppError, ExitCode } from '../src/errors.js';
import { Logger } from '../src/logging.js';

class MockConnection extends EventEmitter {
  public readonly setReconnectAttempt = vi.fn();
  public readonly prepareForReconnect = vi.fn();
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

vi.mock('../src/discord/voice/voice-connection.js', () => ({
  VoiceConnection: vi.fn(
    (_streamer, _dave, _logger, guildId: string | null, _userId: string, channelId: string) => {
      nextVoiceConnection = new MockConnection('voice', guildId, channelId);
      nextVoiceConnection.waitUntilReady = voiceWaitUntilReadyMock;
      return nextVoiceConnection;
    }
  ),
}));

vi.mock('../src/discord/voice/stream-connection.js', () => ({
  StreamConnection: vi.fn(
    (_streamer, _dave, _logger, guildId: string | null, _userId: string, channelId: string) => {
      nextStreamConnection = new MockConnection('stream', guildId, channelId);
      nextStreamConnection.waitUntilReady = streamWaitUntilReadyMock;
      return nextStreamConnection;
    }
  ),
}));

function createClient() {
  return {
    login: vi.fn(),
    destroy: vi.fn(),
    onRaw: vi.fn(),
    offRaw: vi.fn(),
    sendGatewayOpcode: vi.fn(),
    currentUser: vi.fn(() => ({ id: 'user-1' })),
  };
}

describe('Streamer', () => {
  beforeEach(() => {
    vi.resetModules();
    voiceWaitUntilReadyMock = vi.fn();
    streamWaitUntilReadyMock = vi.fn();
  });

  test('retries the initial companion user voice join up to three times', async () => {
    const client = createClient();
    const wrapper = { mediaConnection: {} } as unknown;

    const { Streamer } = await import('../src/discord/streamer.js');
    const streamer = new Streamer(client as never, {} as never, new Logger('test', 'debug'));

    voiceWaitUntilReadyMock
      .mockRejectedValueOnce(new AppError('attempt-1', ExitCode.Gateway))
      .mockRejectedValueOnce(new AppError('attempt-2', ExitCode.Gateway))
      .mockResolvedValueOnce(wrapper);

    const result = await streamer.joinVoice('guild-1', 'channel-1');

    expect(result).toBe(wrapper);
    expect(nextVoiceConnection.prepareForReconnect).toHaveBeenNthCalledWith(1, 1);
    expect(nextVoiceConnection.prepareForReconnect).toHaveBeenNthCalledWith(2, 2);
    expect(nextVoiceConnection.prepareForReconnect).toHaveBeenNthCalledWith(3, 3);
    expect(client.sendGatewayOpcode).toHaveBeenCalledTimes(3);
    expect(client.sendGatewayOpcode).toHaveBeenNthCalledWith(1, 4, expect.any(Object));
  });

  test('reissues voice and stream requests during runtime recovery', async () => {
    const client = createClient();

    const { Streamer } = await import('../src/discord/streamer.js');
    const streamer = new Streamer(client as never, {} as never, new Logger('test', 'debug'));

    voiceWaitUntilReadyMock.mockResolvedValue({ mediaConnection: {} });
    await streamer.joinVoice('guild-1', 'channel-1');

    streamWaitUntilReadyMock.mockResolvedValue({ mediaConnection: {} });
    await streamer.createStream();
    client.sendGatewayOpcode.mockClear();

    streamer.handleConnectionRecoveryRequested(nextVoiceConnection as never, {
      connectionKind: 'voice',
      attempt: 0,
      trigger: 'socket_close',
      state: 'refreshing',
      closeCode: 4014,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(nextVoiceConnection.prepareForReconnect).toHaveBeenCalledWith(1);
    expect(nextStreamConnection.prepareForReconnect).toHaveBeenCalledWith(1);
    expect(client.sendGatewayOpcode).toHaveBeenCalledWith(4, expect.any(Object));
    expect(client.sendGatewayOpcode).toHaveBeenCalledWith(18, expect.any(Object));
    expect(client.sendGatewayOpcode).toHaveBeenCalledWith(22, expect.any(Object));
  });
});
