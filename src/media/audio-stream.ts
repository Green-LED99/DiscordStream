import type { Logger } from '../logging.js';
import type { WebRtcConnectionWrapper } from '../transport/webrtc-connection.js';
import { BaseMediaStream } from './base-media-stream.js';

export class AudioStream extends BaseMediaStream {
  public constructor(
    private readonly connection: WebRtcConnectionWrapper,
    logger: Logger
  ) {
    super('audio', logger);
  }

  protected override async sendFrame(frame: Uint8Array, frameTimeMs: number): Promise<void> {
    this.connection.sendAudioFrame(frame, frameTimeMs);
  }
}
