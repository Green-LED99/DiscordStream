import { AppError, ExitCode } from '../errors.js';
import { getDaveHeapU8 } from './runtime-exports.js';
import type { DaveKeyRatchet, DaveModule } from './types.js';

export class DaveMediaEncryptor {
  private readonly encryptor;
  private framePointer = 0;
  private frameCapacity = 0;

  public constructor(private readonly dave: DaveModule) {
    this.encryptor = new dave.Encryptor();
    getDaveHeapU8(dave);
  }

  public destroy(): void {
    if (this.framePointer !== 0) {
      this.dave._free(this.framePointer);
      this.framePointer = 0;
      this.frameCapacity = 0;
    }
  }

  public assignOpusSsrc(ssrc: number): void {
    this.encryptor.AssignSsrcToCodec(ssrc, this.dave.Codec.Opus);
  }

  public assignH264Ssrc(ssrc: number): void {
    this.encryptor.AssignSsrcToCodec(ssrc, this.dave.Codec.H264);
  }

  public updateSelfKeyRatchet(keyRatchet: DaveKeyRatchet | null): void {
    this.encryptor.SetKeyRatchet(keyRatchet);
    this.encryptor.SetPassthroughMode(keyRatchet === null);
  }

  public encryptAudio(frame: Uint8Array, ssrc: number): Buffer {
    return this.encrypt(this.dave.MediaType.Audio, ssrc, frame);
  }

  public encryptVideo(frame: Uint8Array, ssrc: number): Buffer {
    return this.encrypt(this.dave.MediaType.Video, ssrc, frame);
  }

  private encrypt(mediaType: number, ssrc: number, frame: Uint8Array): Buffer {
    const outputSize = this.encryptor.GetMaxCiphertextByteSize(mediaType, frame.byteLength);
    const framePointer = this.ensureFrameCapacity(outputSize);
    const inputHeap = getDaveHeapU8(this.dave);

    inputHeap.set(frame, framePointer);
    const bytesWritten = this.encryptor.Encrypt(
      mediaType,
      ssrc,
      framePointer,
      frame.byteLength,
      outputSize
    );

    if (bytesWritten <= 0) {
      throw new AppError('libdave encryptor returned no ciphertext.', ExitCode.Dave, {
        mediaType,
        ssrc,
      });
    }

    const outputHeap = getDaveHeapU8(this.dave);
    const output = Buffer.allocUnsafe(bytesWritten);
    output.set(outputHeap.subarray(framePointer, framePointer + bytesWritten));
    return output;
  }

  private ensureFrameCapacity(requiredCapacity: number): number {
    if (requiredCapacity <= this.frameCapacity && this.framePointer !== 0) {
      return this.framePointer;
    }

    if (this.framePointer !== 0) {
      this.dave._free(this.framePointer);
    }

    this.framePointer = this.dave._malloc(requiredCapacity);
    this.frameCapacity = requiredCapacity;
    return this.framePointer;
  }
}
