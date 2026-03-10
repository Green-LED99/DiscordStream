import { describe, expect, test } from 'vitest';
import type { FfprobeResult, FfprobeStream } from '../src/media/ffprobe.js';
import { selectTranscodePlan } from '../src/media/transcode-plan.js';

function buildProbe(streams: FfprobeStream[]): FfprobeResult {
  return { streams };
}

function buildVideoStream(overrides: Partial<FfprobeStream> = {}): FfprobeStream {
  return {
    codec_type: 'video',
    codec_name: 'h264',
    width: 1280,
    height: 720,
    avg_frame_rate: '24/1',
    ...overrides,
  };
}

function buildAudioStream(overrides: Partial<FfprobeStream> = {}): FfprobeStream {
  return {
    codec_type: 'audio',
    codec_name: 'opus',
    sample_rate: '48000',
    channels: 2,
    ...overrides,
  };
}

describe('selectTranscodePlan', () => {
  test('copies compatible H264 and Opus streams', () => {
    const plan = selectTranscodePlan(buildProbe([buildVideoStream(), buildAudioStream()]));

    expect(plan.video.mode).toBe('copy');
    expect(plan.audio?.mode).toBe('copy');
    expect(plan.usesTranscode).toBe(false);
  });

  test('copies video but transcodes incompatible audio', () => {
    const plan = selectTranscodePlan(
      buildProbe([buildVideoStream(), buildAudioStream({ codec_name: 'aac' })])
    );

    expect(plan.video.mode).toBe('copy');
    expect(plan.audio?.mode).toBe('transcode');
    expect(plan.audio).toMatchObject({
      targetCodec: 'opus',
      targetSampleRate: 48_000,
      targetChannels: 2,
    });
  });

  test('transcodes 1080p60 HEVC input down to 720p24 H264', () => {
    const plan = selectTranscodePlan(
      buildProbe([
        buildVideoStream({
          codec_name: 'hevc',
          width: 1920,
          height: 1080,
          avg_frame_rate: '60/1',
        }),
        buildAudioStream({ codec_name: 'aac' }),
      ])
    );

    expect(plan.video.mode).toBe('transcode');
    if (plan.video.mode !== 'transcode') {
      throw new Error('Expected transcode plan');
    }

    expect(plan.video.filters).toEqual(['scale=-2:720', 'fps=24']);
    expect(plan.audio?.mode).toBe('transcode');
  });

  test('transcodes oversized H264 input with scale only', () => {
    const plan = selectTranscodePlan(
      buildProbe([
        buildVideoStream({
          width: 1920,
          height: 1080,
          avg_frame_rate: '24/1',
        }),
      ])
    );

    expect(plan.video.mode).toBe('transcode');
    if (plan.video.mode !== 'transcode') {
      throw new Error('Expected transcode plan');
    }

    expect(plan.video.filters).toEqual(['scale=-2:720']);
  });

  test('transcodes high-fps H264 input with fps reduction only', () => {
    const plan = selectTranscodePlan(
      buildProbe([
        buildVideoStream({
          avg_frame_rate: '30/1',
        }),
      ])
    );

    expect(plan.video.mode).toBe('transcode');
    if (plan.video.mode !== 'transcode') {
      throw new Error('Expected transcode plan');
    }

    expect(plan.video.filters).toEqual(['fps=24']);
  });
});
