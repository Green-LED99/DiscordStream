import type { Logger } from '../logging.js';
import type { TranscodePlan } from './transcode-plan.js';

type FrameKind = 'video' | 'audio';

type FrameBucket = {
  totalSendMs: number;
  frames: number;
};

export class PipelineStats {
  private readonly startedAt = performance.now();
  private readonly frames: Record<FrameKind, FrameBucket> = {
    video: { totalSendMs: 0, frames: 0 },
    audio: { totalSendMs: 0, frames: 0 },
  };
  private ffprobeDurationMs?: number;
  private ffmpegStartedAt?: number;
  private ffmpegStartupDurationMs?: number;
  private lateFrames = 0;
  private maxLateFrameMs = 0;
  private reportTimer: NodeJS.Timeout | undefined;

  public constructor(
    private readonly logger: Logger,
    private readonly plan: TranscodePlan
  ) {}

  public setFfprobeDuration(durationMs: number): void {
    this.ffprobeDurationMs = durationMs;
  }

  public markFfmpegStarted(startedAt = performance.now()): void {
    this.ffmpegStartedAt = startedAt;
  }

  public markFfmpegReady(now = performance.now()): void {
    if (this.ffmpegStartedAt === undefined || this.ffmpegStartupDurationMs !== undefined) {
      return;
    }

    this.ffmpegStartupDurationMs = now - this.ffmpegStartedAt;
  }

  public startPeriodicReporting(intervalMs = 10_000): void {
    if (this.reportTimer) {
      return;
    }

    this.reportTimer = setInterval(() => {
      this.logger.debug('Pipeline summary', this.snapshot('periodic'));
    }, intervalMs);
  }

  public stop(): void {
    if (this.reportTimer) {
      clearInterval(this.reportTimer);
      this.reportTimer = undefined;
    }

    this.logger.debug('Pipeline summary', this.snapshot('final'));
  }

  public recordFrame(kind: FrameKind, sendDurationMs: number): void {
    const bucket = this.frames[kind];
    bucket.frames += 1;
    bucket.totalSendMs += sendDurationMs;
  }

  public recordLateFrame(lateByMs: number): void {
    if (lateByMs <= 0) {
      return;
    }

    this.lateFrames += 1;
    this.maxLateFrameMs = Math.max(this.maxLateFrameMs, lateByMs);
  }

  private snapshot(reason: 'periodic' | 'final'): Record<string, unknown> {
    const elapsedMs = performance.now() - this.startedAt;
    const videoFrames = this.frames.video.frames;
    const audioFrames = this.frames.audio.frames;

    return {
      reason,
      elapsedMs,
      ffprobeMs: this.ffprobeDurationMs,
      ffmpegStartupMs: this.ffmpegStartupDurationMs,
      videoFrames,
      audioFrames,
      effectiveVideoFps: elapsedMs > 0 ? (videoFrames * 1000) / elapsedMs : 0,
      avgVideoSendMs: average(this.frames.video),
      avgAudioSendMs: average(this.frames.audio),
      lateFrames: this.lateFrames,
      maxLateFrameMs: this.maxLateFrameMs,
      usesTranscode: this.plan.usesTranscode,
      videoMode: this.plan.video.mode,
      audioMode: this.plan.audio?.mode ?? 'none',
      videoSourceCodec: this.plan.video.sourceCodec,
      videoSourceHeight: this.plan.video.sourceHeight,
      videoSourceFps: this.plan.video.sourceFps,
      audioSourceCodec: this.plan.audio?.sourceCodec,
      audioSampleRate: this.plan.audio?.sampleRate,
      audioChannels: this.plan.audio?.channels,
    };
  }
}

function average(bucket: FrameBucket): number {
  if (bucket.frames === 0) {
    return 0;
  }

  return bucket.totalSendMs / bucket.frames;
}
