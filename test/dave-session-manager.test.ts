import { describe, expect, test, vi } from 'vitest';
import { DaveSessionManager } from '../src/dave/session-manager.js';
import type { DaveModule } from '../src/dave/types.js';
import { Logger } from '../src/logging.js';

function createFakeDaveModule(): DaveModule {
  class FakeTransientKeys {
    public GetTransientPrivateKey(): object {
      return {};
    }

    public Clear(): void {}
  }

  class FakeSession {
    public protocolVersion = 0;
    public proposalsReturn: number[] | null = null;

    public Init(version: number): void {
      this.protocolVersion = version;
    }

    public Reset(): void {
      this.protocolVersion = 0;
    }

    public SetProtocolVersion(version: number): void {
      this.protocolVersion = version;
    }

    public GetProtocolVersion(): number {
      return this.protocolVersion;
    }

    public GetLastEpochAuthenticator(): number[] {
      return [1, 2, 3];
    }

    public SetExternalSender(): void {}

    public ProcessProposals(): number[] | null {
      return this.proposalsReturn;
    }

    public ProcessCommit(): {
      failed: boolean;
      ignored: boolean;
      rosterUpdate: Record<string, number[]> | null;
    } {
      return {
        failed: false,
        ignored: false,
        rosterUpdate: {
          '1': [1],
        },
      };
    }

    public ProcessWelcome(): Record<string, number[]> | null {
      return {
        '1': [1],
      };
    }

    public GetMarshalledKeyPackage(): number[] {
      return [9, 9, 9];
    }

    public GetKeyRatchet(userId: string): { cipherSuite: number; baseSecret: number[] } | null {
      return {
        cipherSuite: 7,
        baseSecret: [Number(userId.length)],
      };
    }
  }

  return {
    HEAPU8: new Uint8Array(1024),
    _malloc: () => 0,
    _free: () => undefined,
    MaxSupportedProtocolVersion: () => 1,
    MediaType: {
      Audio: 0,
      Video: 1,
    },
    Codec: {
      Unknown: 0,
      Opus: 1,
      VP8: 2,
      VP9: 3,
      H264: 4,
      H265: 5,
      AV1: 6,
    },
    TransientKeys: FakeTransientKeys,
    Session: FakeSession as unknown as DaveModule['Session'],
    Encryptor: class {} as unknown as DaveModule['Encryptor'],
    Decryptor: class {} as unknown as DaveModule['Decryptor'],
  };
}

describe('DaveSessionManager', () => {
  test('sends an MLS key package when DAVE is negotiated', () => {
    const dave = createFakeDaveModule();
    const sendJson = vi.fn();
    const sendBinary = vi.fn();
    const onSelfKeyRatchetUpdated = vi.fn();
    const manager = new DaveSessionManager(
      dave,
      '1234',
      '5678',
      new Logger('test', 'debug'),
      sendJson,
      sendBinary,
      onSelfKeyRatchetUpdated
    );

    manager.onSelectProtocolAck(1);

    expect(sendBinary).toHaveBeenCalledWith(26, Uint8Array.from([9, 9, 9]));
  });

  test('signals transition readiness for non-init transitions', () => {
    const dave = createFakeDaveModule();
    const sendJson = vi.fn();
    const manager = new DaveSessionManager(
      dave,
      '1234',
      '5678',
      new Logger('test', 'debug'),
      sendJson,
      vi.fn(),
      vi.fn()
    );

    manager.onPrepareTransition(33, 1);

    expect(sendJson).toHaveBeenCalledWith(23, { transition_id: 33 });
  });

  test('moves the local encryptor into passthrough when protocol zero executes', () => {
    const dave = createFakeDaveModule();
    const onSelfKeyRatchetUpdated = vi.fn();
    const manager = new DaveSessionManager(
      dave,
      '1234',
      '5678',
      new Logger('test', 'debug'),
      vi.fn(),
      vi.fn(),
      onSelfKeyRatchetUpdated
    );

    manager.onPrepareTransition(44, 0);
    manager.onExecuteTransition(44);

    expect(onSelfKeyRatchetUpdated).toHaveBeenCalledWith(null);
  });
});
