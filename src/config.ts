import { config as loadDotEnv } from 'dotenv';
import { AppError, ExitCode } from './errors.js';
import { type LogLevel, parseLogLevel } from './logging.js';

loadDotEnv();

export type AppConfig = {
  companionToken: string;
  ffmpegPath: string;
  ffprobePath: string;
  logLevel: LogLevel;
};

export function loadConfig(): AppConfig {
  const companionToken = process.env.DISCORD_COMPANION_TOKEN;

  if (!companionToken) {
    throw new AppError('DISCORD_COMPANION_TOKEN is required.', ExitCode.Config);
  }

  return {
    companionToken,
    ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
    ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
    logLevel: parseLogLevel(process.env.LOG_LEVEL),
  };
}
