import type { Streamer } from '../discord/streamer.js';
import type { Logger } from '../logging.js';
import { AudioStream } from './audio-stream.js';
import { demuxNutStream } from './demuxer.js';
import { VideoStream } from './video-stream.js';

export async function playStream(
  input: NodeJS.ReadableStream,
  streamer: Streamer,
  logger: Logger,
  abortSignal?: AbortSignal
): Promise<void> {
  const { video, audio } = await demuxNutStream(input, logger.child('demux'));
  const connection = await streamer.createStream();
  await connection.setPacketizer('H264');
  connection.mediaConnection.setSpeaking(true);
  connection.mediaConnection.setVideoAttributes(true, {
    width: video.width,
    height: video.height,
    fps: Math.round(video.framerateNum / video.framerateDen),
  });

  const videoStream = new VideoStream(connection, logger.child('video'));
  const audioStream = audio ? new AudioStream(connection, logger.child('audio')) : undefined;

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

    const onAbort = () => {
      cleanup();
      reject(abortSignal?.reason ?? new Error('Aborted'));
    };

    abortSignal?.addEventListener('abort', onAbort, { once: true });
    videoStream.once('finish', () => {
      cleanup();
      abortSignal?.removeEventListener('abort', onAbort);
      resolve();
    });
    videoStream.once('error', (error) => {
      cleanup();
      abortSignal?.removeEventListener('abort', onAbort);
      reject(error);
    });
  });
}
