import type { Logger } from '../logging.js';
import type { WebRtcConnectionWrapper } from '../transport/webrtc-connection.js';
import { BaseMediaStream } from './base-media-stream.js';

export class VideoStream extends BaseMediaStream {
  public constructor(
    private readonly connection: WebRtcConnectionWrapper,
    logger: Logger
  ) {
    super('video', logger);
  }

  protected override async sendFrame(frame: Uint8Array, frameTimeMs: number): Promise<void> {
    this.connection.sendVideoFrame(frame, frameTimeMs);
  }
}
