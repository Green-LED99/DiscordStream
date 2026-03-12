import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createUserGatewaySession } from '../src/discord/user-gateway-session.js';
import { AppError } from '../src/errors.js';
import { Logger } from '../src/logging.js';

class FakeWebSocket {
  public static readonly CONNECTING = 0;
  public static readonly OPEN = 1;
  public static readonly CLOSING = 2;
  public static readonly CLOSED = 3;
  public static instances: FakeWebSocket[] = [];

  public readonly sent: unknown[] = [];
  public readyState = FakeWebSocket.CONNECTING;

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

  public dispatch(payload: unknown): void {
    this.emit('message', {
      data: JSON.stringify(payload),
    } as MessageEvent);
  }

  private emit(type: 'open' | 'message' | 'close', event: Event | MessageEvent | CloseEvent): void {
    for (const listener of this.listeners[type]) {
      listener(event as never);
    }
  }
}

describe('UserGatewaySession', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ url: 'wss://gateway.discord.test' }),
      }))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('identifies and exposes the authenticated user', async () => {
    const session = createUserGatewaySession(new Logger('test', 'debug'));
    const loginPromise = session.login('user-token');
    await vi.waitFor(() => {
      expect(FakeWebSocket.instances[0]).toBeDefined();
    });
    const socket = FakeWebSocket.instances[0];

    socket?.open();
    socket?.dispatch({
      op: 10,
      d: {
        heartbeat_interval: 45_000,
      },
    });
    await vi.waitFor(() => {
      expect(socket?.sent.length).toBeGreaterThan(0);
    });

    const identifyMessage = socket?.sent.find((message) => String(message).includes('"op":2'));
    const identifyPayload = JSON.parse(String(identifyMessage)) as {
      op: number;
      d: { capabilities: number; properties: { browser: string } };
    };
    expect(identifyPayload.op).toBe(2);
    expect(identifyPayload.d.capabilities).toBeGreaterThan(0);
    expect(identifyPayload.d.properties.browser).toBe('Discord Client');

    socket?.dispatch({
      op: 0,
      t: 'READY',
      s: 1,
      d: {
        user: {
          id: 'user-1',
          username: 'companion',
        },
        session_id: 'gateway-session',
        resume_gateway_url: 'wss://resume.discord.test',
      },
    });

    await loginPromise;
    expect(session.currentUser()).toMatchObject({
      id: 'user-1',
      username: 'companion',
    });
    expect(session.sessionSnapshot()).toMatchObject({
      sessionId: 'gateway-session',
      seq: 1,
      resumeGatewayUrl: 'wss://resume.discord.test',
    });
    session.destroy();
  });

  test('resumes the gateway session after a reconnect', async () => {
    const session = createUserGatewaySession(new Logger('test', 'debug'));
    const loginPromise = session.login('user-token');
    await vi.waitFor(() => {
      expect(FakeWebSocket.instances[0]).toBeDefined();
    });
    const firstSocket = FakeWebSocket.instances[0];

    firstSocket?.open();
    firstSocket?.dispatch({
      op: 10,
      d: {
        heartbeat_interval: 45_000,
      },
    });
    firstSocket?.dispatch({
      op: 0,
      t: 'READY',
      s: 5,
      d: {
        user: { id: 'user-1' },
        session_id: 'gateway-session',
        resume_gateway_url: 'wss://resume.discord.test',
      },
    });
    await loginPromise;

    firstSocket?.close(1006, 'network');
    await vi.waitFor(() => {
      expect(FakeWebSocket.instances[1]).toBeDefined();
    });

    const resumedSocket = FakeWebSocket.instances[1];
    resumedSocket?.open();
    resumedSocket?.dispatch({
      op: 10,
      d: {
        heartbeat_interval: 45_000,
      },
    });
    await vi.waitFor(() => {
      expect(resumedSocket?.sent.length).toBeGreaterThan(0);
    });

    const resumeMessage = resumedSocket?.sent.find((message) => String(message).includes('"op":6'));
    const resumePayload = JSON.parse(String(resumeMessage)) as {
      op: number;
      d: { session_id: string; seq: number };
    };
    expect(resumePayload.op).toBe(6);
    expect(resumePayload.d.session_id).toBe('gateway-session');
    expect(resumePayload.d.seq).toBe(5);
    session.destroy();
  });

  test('rejects stage channels during preflight when metadata is available', async () => {
    const session = createUserGatewaySession(new Logger('test', 'debug'));
    const loginPromise = session.login('user-token');
    await vi.waitFor(() => {
      expect(FakeWebSocket.instances[0]).toBeDefined();
    });
    const socket = FakeWebSocket.instances[0];

    socket?.open();
    socket?.dispatch({
      op: 10,
      d: {
        heartbeat_interval: 45_000,
      },
    });
    socket?.dispatch({
      op: 0,
      t: 'READY',
      s: 1,
      d: {
        user: { id: 'user-1' },
        session_id: 'gateway-session',
        resume_gateway_url: 'wss://resume.discord.test',
        guilds: [
          {
            id: 'guild-1',
            owner_id: 'owner-1',
            roles: [
              { id: 'guild-1', permissions: '1049088' },
              { id: 'role-1', permissions: '0' },
            ],
            channels: [
              {
                id: 'channel-1',
                guild_id: 'guild-1',
                type: 13,
                permission_overwrites: [],
              },
            ],
            members: [
              {
                user: { id: 'user-1' },
                roles: ['role-1'],
              },
            ],
            voice_states: [],
          },
        ],
      },
    });
    await loginPromise;

    await expect(session.preflightVoiceJoin('guild-1', 'channel-1')).rejects.toBeInstanceOf(
      AppError
    );
    session.destroy();
  });
});
