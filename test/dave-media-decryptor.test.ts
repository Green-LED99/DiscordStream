import { describe, expect, test } from 'vitest';
import { DaveMediaDecryptor } from '../src/dave/media-decryptor.js';
import type { DaveModule } from '../src/dave/types.js';

function createDecryptorModule(resultBytes: number): DaveModule {
  const heap = new Uint8Array(1024);

  class FakeDecryptor {
    public TransitionToKeyRatchet(): void {}
    public TransitionToPassthroughMode(): void {}
    public GetMaxPlaintextByteSize(_mediaType: number, ciphertextByteSize: number): number {
      return ciphertextByteSize;
    }
    public Decrypt(_mediaType: number, pointer: number, frameLength: number): number {
      for (let index = 0; index < frameLength; index += 1) {
        heap[pointer + index] = (heap[pointer + index] ?? 0) ^ 0xff;
      }

      return resultBytes;
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
    TransientKeys: class {} as unknown as DaveModule['TransientKeys'],
    Session: class {} as unknown as DaveModule['Session'],
    Encryptor: class {} as unknown as DaveModule['Encryptor'],
    Decryptor: FakeDecryptor as unknown as DaveModule['Decryptor'],
  };
}

describe('DaveMediaDecryptor', () => {
  test('returns decrypted bytes when libdave succeeds', () => {
    const decryptor = new DaveMediaDecryptor(createDecryptorModule(3));
    const output = decryptor.decryptAudio(Uint8Array.from([0xfe, 0xfd, 0xfc]));
    expect(Array.from(output)).toEqual([1, 2, 3]);
  });

  test('throws a DAVE error when the module does not expose HEAPU8', () => {
    const moduleWithoutHeap = {
      ...createDecryptorModule(3),
      HEAPU8: undefined,
    } as unknown as DaveModule;

    expect(() => new DaveMediaDecryptor(moduleWithoutHeap)).toThrow(/did not expose HEAPU8/);
  });
});
