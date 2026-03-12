import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { DaveModule } from '../src/dave/types.js';
import type { Streamer } from '../src/discord/streamer.js';
import { BaseMediaConnection } from '../src/discord/voice/base-media-connection.js';
import { classifyVoiceCloseCode } from '../src/discord/voice/reconnect.js';
import type { ConnectionKind } from '../src/discord/voice/reconnect.js';
import { AppError, ExitCode } from '../src/errors.js';
import { Logger } from '../src/logging.js';

class FakeWebSocket {
  public static readonly CONNECTING = 0;
  public static readonly OPEN = 1;
  public static readonly CLOSING = 2;
  public static readonly CLOSED = 3;
  public static instances: FakeWebSocket[] = [];

  public readonly sent: unknown[] = [];
  public readyState = FakeWebSocket.CONNECTING;
  public binaryType = 'blob';

  private readonly listeners = {
    open: new Set<(event: Event) => void>(),
    message: new Set<(event: MessageEvent) => void>(),
    close: new Set<(event: CloseEvent) => void>(),
  };

  public constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  public addEventListener(
    type: 'open' | 'message' | 'close',
    listener: (event: Event | MessageEvent | CloseEvent) => void
  ): void {
    this.listeners[type].add(listener as never);
  }

  public send(payload: unknown): void {
    this.sent.push(payload);
  }

  public open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit('open', {} as Event);
  }

  public close(code = 1000, reason = ''): void {
    if (this.readyState === FakeWebSocket.CLOSED) {
      return;
    }

    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close', { code, reason } as CloseEvent);
  }

  public dispatchMessage(data: string): void {
    this.emit('message', { data } as MessageEvent);
  }

  private emit(type: 'open' | 'message' | 'close', event: Event | MessageEvent | CloseEvent): void {
    for (const listener of this.listeners[type]) {
      listener(event as never);
    }
  }
}

class TestConnection extends BaseMediaConnection {
  public override get connectionKind(): ConnectionKind {
    return 'voice';
  }

  public override get serverId(): string | null {
    return this.guildId ?? this.channelId;
  }

  public override get daveChannelId(): string {
    return this.channelId;
  }
}

function createDaveModule(): DaveModule {
  const heap = new Uint8Array(2048);

  class FakeEncryptor {
    public SetKeyRatchet(): void {}
    public SetPassthroughMode(): void {}
    public AssignSsrcToCodec(): void {}
    public GetMaxCiphertextByteSize(_mediaType: number, plaintextByteSize: number): number {
      return plaintextByteSize + 16;
    }
    public Encrypt(): number {
      return 1;
    }
  }

  class FakeTransientKeys {
    public GetTransientPrivateKey(): number[] {
      return [];
    }
  }

  class FakeSession {
    public Reset(): void {}
    public SetProtocolVersion(): void {}
    public Init(): void {}
    public GetProtocolVersion(): number {
      return 1;
    }
    public GetKeyRatchet(): null {
      return null;
    }
    public SetExternalSender(): void {}
    public GetMarshalledKeyPackage(): number[] {
      return [];
    }
    public ProcessProposals(): null {
      return null;
    }
    public ProcessCommit(): { ignored: boolean; failed: boolean; rosterUpdate: null } {
      return { ignored: false, failed: false, rosterUpdate: null };
    }
    public ProcessWelcome(): null {
      return null;
    }
  }

  return {
    HEAPU8: heap,
    _malloc: () => 0,
    _free: () => undefined,
    MaxSupportedProtocolVersion: () => 1,
    MediaType: { Audio: 0, Video: 1 },
    Codec: {
      Unknown: 0,
      Opus: 1,
      VP8: 2,
      VP9: 3,
      H264: 4,
      H265: 5,
      AV1: 6,
    },
    TransientKeys: FakeTransientKeys as unknown as DaveModule['TransientKeys'],
    Session: FakeSession as unknown as DaveModule['Session'],
    Encryptor: FakeEncryptor as unknown as DaveModule['Encryptor'],
    Decryptor: class {} as unknown as DaveModule['Decryptor'],
  };
}

function createStreamerMock(): Streamer & {
  handleConnectionRecoveryRequested: ReturnType<typeof vi.fn>;
  handleConnectionFatal: ReturnType<typeof vi.fn>;
} {
  return {
    handleConnectionRecoveryRequested: vi.fn(),
    handleConnectionFatal: vi.fn(),
  } as unknown as Streamer & {
    handleConnectionRecoveryRequested: ReturnType<typeof vi.fn>;
    handleConnectionFatal: ReturnType<typeof vi.fn>;
  };
}

function createConnection(streamer = createStreamerMock()): {
  connection: TestConnection;
  streamer: ReturnType<typeof createStreamerMock>;
} {
  const connection = new TestConnection(
    streamer,
    createDaveModule(),
    new Logger('test', 'debug'),
    'guild-1',
    'user-1',
    'channel-1'
  );

  return { connection, streamer };
}

describe('classifyVoiceCloseCode', () => {
  test('classifies resume codes', () => {
    expect(classifyVoiceCloseCode(1000)).toBe('resume');
    expect(classifyVoiceCloseCode(4015)).toBe('resume');
  });

  test('classifies forced refresh codes', () => {
    expect(classifyVoiceCloseCode(4014)).toBe('refresh');
  });

  test('classifies fatal close codes', () => {
    expect(classifyVoiceCloseCode(4006)).toBe('fatal');
  });
});

describe('BaseMediaConnection reconnect handling', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test('resumes the websocket after a 4015 close', () => {
    const { connection, streamer } = createConnection();
    connection.setSession('session-1');
    connection.setTokens('voice.discord.test', 'token-1');

    const firstSocket = FakeWebSocket.instances[0];
    firstSocket?.open();
    firstSocket?.close(4015, 'server_restart');

    const resumedSocket = FakeWebSocket.instances[1];
    resumedSocket?.open();

    const payload = JSON.parse(String(resumedSocket?.sent[0])) as {
      op: number;
      d: { session_id: string };
    };
    expect(payload.op).toBe(7);
    expect(payload.d.session_id).toBe('session-1');
    expect(streamer.handleConnectionRecoveryRequested).not.toHaveBeenCalled();
  });

  test('requests a refresh after a 4014 close', () => {
    const { connection, streamer } = createConnection();
    connection.setSession('session-1');
    connection.setTokens('voice.discord.test', 'token-1');

    const firstSocket = FakeWebSocket.instances[0];
    firstSocket?.open();
    firstSocket?.close(4014, 'force_disconnect');

    expect(streamer.handleConnectionRecoveryRequested).toHaveBeenCalledWith(
      connection,
      expect.objectContaining({
        connectionKind: 'voice',
        trigger: 'socket_close',
        closeCode: 4014,
      })
    );
  });

  test('surfaces fatal close codes', () => {
    const { connection, streamer } = createConnection();
    connection.setSession('session-1');
    connection.setTokens('voice.discord.test', 'token-1');

    const firstSocket = FakeWebSocket.instances[0];
    firstSocket?.open();
    firstSocket?.close(4006, 'invalid_session');

    expect(streamer.handleConnectionFatal).toHaveBeenCalledWith(
      connection,
      expect.objectContaining({
        exitCode: ExitCode.Gateway,
      })
    );
  });

  test('requests recovery after two missed heartbeat acknowledgements', () => {
    vi.useFakeTimers();

    const { connection, streamer } = createConnection();
    connection.setSession('session-1');
    connection.setTokens('voice.discord.test', 'token-1');

    const socket = FakeWebSocket.instances[0];
    socket?.open();
    socket?.sent.length && socket.sent.splice(0, socket.sent.length);
    socket?.dispatchMessage(JSON.stringify({ op: 8, d: { heartbeat_interval: 100 } }));

    vi.advanceTimersByTime(300);

    expect(streamer.handleConnectionRecoveryRequested).toHaveBeenCalledWith(
      connection,
      expect.objectContaining({
        connectionKind: 'voice',
        trigger: 'heartbeat_timeout',
      })
    );
  });

  test('waitUntilReady rejects on fatal disconnect', async () => {
    const { connection } = createConnection();
    const wait = connection.waitUntilReady(10);

    connection.emit('fatal_disconnect', new AppError('fatal', ExitCode.Gateway));

    await expect(wait).rejects.toBeInstanceOf(AppError);
  });
});
