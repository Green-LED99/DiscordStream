import { AppError, ExitCode } from '../errors.js';
import type { DaveKeyRatchet, DaveModule } from './types.js';

export class DaveMediaEncryptor {
  private readonly encryptor;

  public constructor(private readonly dave: DaveModule) {
    this.encryptor = new dave.Encryptor();
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

  public encryptAudio(frame: Uint8Array, ssrc: number): Uint8Array {
    return this.encrypt(this.dave.MediaType.Audio, ssrc, frame);
  }

  public encryptVideo(frame: Uint8Array, ssrc: number): Uint8Array {
    return this.encrypt(this.dave.MediaType.Video, ssrc, frame);
  }

  private encrypt(mediaType: number, ssrc: number, frame: Uint8Array): Uint8Array {
    const outputSize = this.encryptor.GetMaxCiphertextByteSize(mediaType, frame.byteLength);
    const framePointer = this.dave._malloc(outputSize);

    try {
      this.dave.HEAPU8.set(frame, framePointer);
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

      return Uint8Array.from(this.dave.HEAPU8.subarray(framePointer, framePointer + bytesWritten));
    } finally {
      this.dave._free(framePointer);
    }
  }
}
