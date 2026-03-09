import { describe, expect, test } from 'vitest';
import { DaveMediaEncryptor } from '../src/dave/media-encryptor.js';
import type { DaveModule } from '../src/dave/types.js';
import { AppError } from '../src/errors.js';

function createEncryptorModule(resultBytes: number): DaveModule {
  const heap = new Uint8Array(1024);

  class FakeEncryptor {
    public SetKeyRatchet(): void {}
    public SetPassthroughMode(): void {}
    public AssignSsrcToCodec(): void {}
    public GetProtocolVersion(): number {
      return 1;
    }
    public GetMaxCiphertextByteSize(_mediaType: number, plaintextByteSize: number): number {
      return plaintextByteSize + 8;
    }
    public Encrypt(
      _mediaType: number,
      _ssrc: number,
      pointer: number,
      frameLength: number
    ): number {
      for (let index = 0; index < frameLength; index += 1) {
        heap[pointer + index] = (heap[pointer + index] ?? 0) ^ 0xff;
      }

      return resultBytes;
    }
    public SetProtocolVersionChangedCallback(): void {}
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
    TransientKeys: class {} as unknown as DaveModule['TransientKeys'],
    Session: class {} as unknown as DaveModule['Session'],
    Encryptor: FakeEncryptor as unknown as DaveModule['Encryptor'],
    Decryptor: class {} as unknown as DaveModule['Decryptor'],
  };
}

describe('DaveMediaEncryptor', () => {
  test('returns encrypted bytes when libdave succeeds', () => {
    const encryptor = new DaveMediaEncryptor(createEncryptorModule(3));
    const output = encryptor.encryptAudio(Uint8Array.from([1, 2, 3]), 99);
    expect(Array.from(output)).toEqual([254, 253, 252]);
  });

  test('throws when libdave reports a zero-length ciphertext', () => {
    const encryptor = new DaveMediaEncryptor(createEncryptorModule(0));
    expect(() => encryptor.encryptAudio(Uint8Array.from([1, 2, 3]), 99)).toThrow(AppError);
  });
});
