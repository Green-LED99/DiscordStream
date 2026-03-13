import { config as loadDotEnv } from 'dotenv';
import {
  type CompanionTokenProviderConfig,
  parseCompanionTokenProviderConfig,
} from './companion-token-provider.js';
import { type LogLevel, parseLogLevel } from './logging.js';

loadDotEnv();

export type AppConfig = {
  companionTokenProvider: CompanionTokenProviderConfig;
  ffmpegPath: string;
  ffprobePath: string;
  logLevel: LogLevel;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    companionTokenProvider: parseCompanionTokenProviderConfig(env),
    ffmpegPath: env.FFMPEG_PATH || 'ffmpeg',
    ffprobePath: env.FFPROBE_PATH || 'ffprobe',
    logLevel: parseLogLevel(env.LOG_LEVEL),
  };
}
