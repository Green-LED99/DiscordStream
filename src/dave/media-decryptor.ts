import { AppError, ExitCode } from '../errors.js';
import { getDaveHeapU8 } from './runtime-exports.js';
import type { DaveKeyRatchet, DaveModule } from './types.js';

export class DaveMediaDecryptor {
  private readonly decryptor;

  public constructor(private readonly dave: DaveModule) {
    this.decryptor = new dave.Decryptor();
    getDaveHeapU8(dave);
  }

  public transitionToKeyRatchet(keyRatchet: DaveKeyRatchet | null): void {
    this.decryptor.TransitionToKeyRatchet(keyRatchet);
  }

  public transitionToPassthroughMode(passthroughMode: boolean): void {
    this.decryptor.TransitionToPassthroughMode(passthroughMode);
  }

  public decryptAudio(frame: Uint8Array): Uint8Array {
    return this.decrypt(this.dave.MediaType.Audio, frame);
  }

  public decryptVideo(frame: Uint8Array): Uint8Array {
    return this.decrypt(this.dave.MediaType.Video, frame);
  }

  private decrypt(mediaType: number, frame: Uint8Array): Uint8Array {
    const outputSize = this.decryptor.GetMaxPlaintextByteSize(mediaType, frame.byteLength);
    const framePointer = this.dave._malloc(outputSize);

    try {
      const inputHeap = getDaveHeapU8(this.dave);
      inputHeap.set(frame, framePointer);
      const bytesWritten = this.decryptor.Decrypt(
        mediaType,
        framePointer,
        frame.byteLength,
        outputSize
      );

      if (bytesWritten <= 0) {
        throw new AppError('libdave decryptor returned no plaintext.', ExitCode.Dave, {
          mediaType,
        });
      }

      const outputHeap = getDaveHeapU8(this.dave);
      return Uint8Array.from(outputHeap.subarray(framePointer, framePointer + bytesWritten));
    } finally {
      this.dave._free(framePointer);
    }
  }
}
