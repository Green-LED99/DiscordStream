import { type ChildProcess, spawn } from 'node:child_process';
import { AppError, ExitCode } from '../errors.js';

export type FfmpegNutProcess = {
  child: ChildProcess;
  output: NodeJS.ReadableStream;
  wait: Promise<void>;
  stop(): void;
};

export function createFfmpegNutProcess(ffmpegPath: string, url: string): FfmpegNutProcess {
  const args = [
    '-v',
    'warning',
    '-reconnect',
    '1',
    '-reconnect_streamed',
    '1',
    '-reconnect_at_eof',
    '1',
    '-i',
    url,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-tune',
    'zerolatency',
    '-pix_fmt',
    'yuv420p',
    '-vf',
    'scale=-2:720',
    '-r',
    '30',
    '-b:v',
    '2500k',
    '-maxrate:v',
    '3500k',
    '-bufsize:v',
    '1250k',
    '-bf',
    '0',
    '-force_key_frames',
    'expr:gte(t,n_forced*1)',
    '-c:a',
    'libopus',
    '-ac',
    '2',
    '-ar',
    '48000',
    '-b:a',
    '128k',
    '-f',
    'nut',
    'pipe:1',
  ];

  const child = spawn(ffmpegPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stderr: Buffer[] = [];
  child.stderr.on('data', (chunk) => {
    stderr.push(Buffer.from(chunk));
  });

  const wait = new Promise<void>((resolve, reject) => {
    child.once('exit', (code) => {
      if (code === 0 || code === null) {
        resolve();
        return;
      }

      reject(
        new AppError('ffmpeg exited with an error.', ExitCode.Media, {
          code,
          stderr: Buffer.concat(stderr).toString('utf8'),
        })
      );
    });
    child.once('error', (error) => {
      reject(
        new AppError('Unable to start ffmpeg.', ExitCode.Media, {
          message: error.message,
        })
      );
    });
  });

  return {
    child,
    output: child.stdout,
    wait,
    stop(): void {
      child.kill('SIGTERM');
    },
  };
}
