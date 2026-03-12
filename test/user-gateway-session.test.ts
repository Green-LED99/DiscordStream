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
    vi.restoreAllMocks();
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
      d: {
        capabilities: number;
        properties: {
          browser: string;
          client_launch_id: string;
          client_heartbeat_session_id: string;
        };
        presence: {
          status: string;
        };
      };
    };
    expect(identifyPayload.op).toBe(2);
    expect(identifyPayload.d.capabilities).toBe(16_381);
    expect(identifyPayload.d.properties.browser).toBe('Discord Client');
    expect(identifyPayload.d.properties.client_launch_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(identifyPayload.d.properties.client_heartbeat_session_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(identifyPayload.d.presence.status).toBe('unknown');

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

  test('responds immediately when the gateway requests an extra heartbeat', async () => {
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
      const heartbeatCount = socket?.sent.filter((message) =>
        String(message).includes('"op":1')
      ).length;
      expect(heartbeatCount).toBeGreaterThan(0);
    });

    const initialHeartbeatCount = socket?.sent.filter((message) =>
      String(message).includes('"op":1')
    ).length;
    socket?.dispatch({
      op: 1,
      d: null,
    });

    await vi.waitFor(() => {
      const heartbeatCount = socket?.sent.filter((message) =>
        String(message).includes('"op":1')
      ).length;
      expect(heartbeatCount).toBe((initialHeartbeatCount ?? 0) + 1);
    });

    socket?.dispatch({
      op: 0,
      t: 'READY',
      s: 1,
      d: {
        user: { id: 'user-1' },
        session_id: 'gateway-session',
        resume_gateway_url: 'wss://resume.discord.test',
      },
    });
    await loginPromise;
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

  test('re-identifies instead of resuming after an invalid sequence close', async () => {
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

    firstSocket?.close(4007, 'invalid_seq');
    await vi.waitFor(() => {
      expect(FakeWebSocket.instances[1]).toBeDefined();
    });

    const nextSocket = FakeWebSocket.instances[1];
    nextSocket?.open();
    nextSocket?.dispatch({
      op: 10,
      d: {
        heartbeat_interval: 45_000,
      },
    });

    await vi.waitFor(() => {
      expect(nextSocket?.sent.length).toBeGreaterThan(0);
    });

    expect(nextSocket?.sent.some((message) => String(message).includes('"op":6'))).toBe(false);
    expect(nextSocket?.sent.some((message) => String(message).includes('"op":2'))).toBe(true);
    session.destroy();
  });

  test('re-identifies on the existing websocket after a non-resumable invalid session', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
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
      s: 5,
      d: {
        user: { id: 'user-1' },
        session_id: 'gateway-session',
        resume_gateway_url: 'wss://resume.discord.test',
      },
    });
    await loginPromise;

    const identifyCountBefore = socket?.sent.filter((message) =>
      String(message).includes('"op":2')
    ).length;

    socket?.dispatch({
      op: 9,
      d: false,
    });

    await vi.waitFor(
      () => {
        const identifyCountAfter = socket?.sent.filter((message) =>
          String(message).includes('"op":2')
        ).length;
        expect(identifyCountAfter).toBe((identifyCountBefore ?? 0) + 1);
        expect(FakeWebSocket.instances).toHaveLength(1);
      },
      {
        timeout: 2_500,
      }
    );

    session.destroy();
  });

  test('treats too many gateway sessions as fatal', async () => {
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
    socket?.close(4015, 'too_many_sessions');

    await expect(loginPromise).rejects.toBeInstanceOf(AppError);
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

  test('rejects guild media channels during preflight when metadata is available', async () => {
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
                type: 16,
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

  test('reports guild video limits from guild metadata during preflight', async () => {
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
            max_video_channel_users: 25,
            roles: [
              { id: 'guild-1', permissions: '1049088' },
              { id: 'role-1', permissions: '0' },
            ],
            channels: [
              {
                id: 'channel-1',
                guild_id: 'guild-1',
                type: 2,
                user_limit: 99,
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

    await expect(session.preflightVoiceJoin('guild-1', 'channel-1')).resolves.toMatchObject({
      occupancy: expect.objectContaining({
        maxVideoChannelUsers: 25,
      }),
    });
    session.destroy();
  });
});
