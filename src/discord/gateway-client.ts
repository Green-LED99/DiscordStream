import type { GatewayEvent } from './gateway-events.js';

export type RawGatewayListener = (event: GatewayEvent) => void;

export type GatewayUser = {
  id: string;
  bot?: boolean;
};

export interface CompanionGatewayClient {
  login(token: string): Promise<void>;
  destroy(): void;
  onRaw(listener: RawGatewayListener): void;
  offRaw(listener: RawGatewayListener): void;
  sendGatewayOpcode(opcode: number, payload: unknown): void;
  currentUser(): GatewayUser | null;
}

export async function createCompanionGatewayClient(): Promise<CompanionGatewayClient> {
  const imported = (await import('discord.js-selfbot-v13')) as {
    Client: new (
      options?: Record<string, unknown>
    ) => {
      login(token: string): Promise<string>;
      destroy(): void;
      on(event: 'raw', listener: RawGatewayListener): void;
      off(event: 'raw', listener: RawGatewayListener): void;
      ws: { broadcast(payload: unknown): void };
      user: GatewayUser | null;
    };
  };

  const client = new imported.Client({
    checkUpdate: false,
  });

  return {
    async login(token: string): Promise<void> {
      await client.login(token);
    },
    destroy(): void {
      client.destroy();
    },
    onRaw(listener: RawGatewayListener): void {
      client.on('raw', listener);
    },
    offRaw(listener: RawGatewayListener): void {
      client.off('raw', listener);
    },
    sendGatewayOpcode(opcode: number, payload: unknown): void {
      client.ws.broadcast({
        op: opcode,
        d: payload,
      });
    },
    currentUser(): GatewayUser | null {
      return client.user;
    },
  };
}
