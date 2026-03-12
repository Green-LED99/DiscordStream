import type { Streamer } from '../discord/streamer.js';
import type { Logger } from '../logging.js';
import { AudioStream } from './audio-stream.js';
import { demuxNutStream } from './demuxer.js';
import type { PipelineStats } from './pipeline-stats.js';
import { VideoStream } from './video-stream.js';

export async function playStream(
  input: NodeJS.ReadableStream,
  streamer: Streamer,
  logger: Logger,
  stats?: PipelineStats,
  abortSignal?: AbortSignal
): Promise<void> {
  const { video, audio } = await demuxNutStream(input, logger.child('demux'));
  stats?.markFfmpegReady();
  stats?.startPeriodicReporting();
  const connection = await streamer.createStream();
  await connection.setPacketizer('H264');
  connection.mediaConnection.setSpeaking(true);
  connection.mediaConnection.setVideoAttributes(true, {
    width: video.width,
    height: video.height,
    fps: Math.round(video.framerateNum / video.framerateDen),
  });

  const videoStream = new VideoStream(connection, stats);
  const audioStream = audio ? new AudioStream(connection, stats) : undefined;

  if (audio && audioStream) {
    videoStream.syncStream = audioStream;
    audioStream.syncStream = undefined;
    audio.stream.pipe(audioStream);
  }

  video.stream.pipe(videoStream);

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      streamer.stopStream();
      connection.mediaConnection.setSpeaking(false);
      connection.mediaConnection.setVideoAttributes(false);
    };

    const onFatal = (error: Error) => {
      cleanup();
      abortSignal?.removeEventListener('abort', onAbort);
      streamer.offFatal(onFatal);
      reject(error);
    };

    const onAbort = () => {
      cleanup();
      streamer.offFatal(onFatal);
      reject(abortSignal?.reason ?? new Error('Aborted'));
    };

    abortSignal?.addEventListener('abort', onAbort, { once: true });
    streamer.onFatal(onFatal);
    videoStream.once('finish', () => {
      cleanup();
      abortSignal?.removeEventListener('abort', onAbort);
      streamer.offFatal(onFatal);
      resolve();
    });
    videoStream.once('error', (error) => {
      cleanup();
      abortSignal?.removeEventListener('abort', onAbort);
      streamer.offFatal(onFatal);
      reject(error);
    });
  });
}
