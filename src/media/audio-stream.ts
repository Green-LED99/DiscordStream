import type { WebRtcConnectionWrapper } from '../transport/webrtc-connection.js';
import { BaseMediaStream } from './base-media-stream.js';
import type { PipelineStats } from './pipeline-stats.js';

export class AudioStream extends BaseMediaStream {
  public constructor(
    private readonly connection: WebRtcConnectionWrapper,
    stats?: PipelineStats
  ) {
    super('audio', stats);
  }

  protected override async sendFrame(frame: Uint8Array, frameTimeMs: number): Promise<void> {
    this.connection.sendAudioFrame(frame, frameTimeMs);
  }
}
