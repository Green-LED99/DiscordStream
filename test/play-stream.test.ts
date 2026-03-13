import { PassThrough, Writable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const demuxNutStream = vi.fn();

vi.mock('../src/media/demuxer.js', () => ({
  demuxNutStream,
}));

vi.mock('../src/media/video-stream.js', () => ({
  VideoStream: class VideoStream extends Writable {
    constructor() {
      super({ objectMode: true });
    }

    override _write(
      _chunk: unknown,
      _encoding: BufferEncoding,
      callback: (error?: Error | null) => void
    ): void {
      callback();
    }
  },
}));

vi.mock('../src/media/audio-stream.js', () => ({
  AudioStream: class AudioStream extends Writable {
    constructor() {
      super({ objectMode: true });
    }

    override _write(
      _chunk: unknown,
      _encoding: BufferEncoding,
      callback: (error?: Error | null) => void
    ): void {
      callback();
    }
  },
}));

describe('playStream', () => {
  const stopStream = vi.fn();
  const onFatal = vi.fn();
  const offFatal = vi.fn();
  const setPacketizer = vi.fn();
  const setSpeaking = vi.fn();
  const setVideoAttributes = vi.fn();

  beforeEach(() => {
    demuxNutStream.mockReset();
    stopStream.mockReset();
    onFatal.mockReset();
    offFatal.mockReset();
    setPacketizer.mockReset();
    setSpeaking.mockReset();
    setVideoAttributes.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('rejects when the demuxed video stream errors', async () => {
    const sourceVideoStream = new PassThrough({ objectMode: true });
    demuxNutStream.mockResolvedValue({
      video: {
        index: 0,
        codec: 'H264',
        width: 1280,
        height: 720,
        framerateNum: 24,
        framerateDen: 1,
        stream: sourceVideoStream,
      },
    });

    const logger = {
      child: () => logger,
    };

    const streamer = {
      createStream: vi.fn().mockResolvedValue({
        setPacketizer,
        mediaConnection: {
          setSpeaking,
          setVideoAttributes,
        },
      }),
      stopStream,
      onFatal,
      offFatal,
    };

    const { playStream } = await import('../src/media/play-stream.js');

    const promise = playStream(new PassThrough(), streamer as never, logger as never);
    const demuxError = new Error('demux failed');
    sourceVideoStream.destroy(demuxError);

    await expect(promise).rejects.toThrow('demux failed');
    expect(stopStream).toHaveBeenCalledTimes(1);
    expect(setSpeaking).toHaveBeenCalledWith(false);
    expect(setVideoAttributes).toHaveBeenCalledWith(false);
  });
});
