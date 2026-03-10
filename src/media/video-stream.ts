import type { WebRtcConnectionWrapper } from '../transport/webrtc-connection.js';
import { BaseMediaStream } from './base-media-stream.js';
import type { PipelineStats } from './pipeline-stats.js';

export class VideoStream extends BaseMediaStream {
  public constructor(
    private readonly connection: WebRtcConnectionWrapper,
    stats?: PipelineStats
  ) {
    super('video', stats);
  }

  protected override async sendFrame(frame: Uint8Array, frameTimeMs: number): Promise<void> {
    this.connection.sendVideoFrame(frame, frameTimeMs);
  }
}
