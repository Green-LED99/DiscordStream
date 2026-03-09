import type { Command } from 'commander';
import type { StreamJobSpec } from '../contracts.js';
import { AppError, ExitCode } from '../errors.js';
import { runStreamJob } from '../runtime/run-stream-job.js';

function requireSnowflake(value: string, flag: string): string {
  if (!/^\d{17,20}$/.test(value)) {
    throw new AppError(`${flag} must be a Discord snowflake.`, ExitCode.Config, { value });
  }

  return value;
}

export function registerPlayUrlCommand(program: Command): void {
  program
    .command('play-url')
    .description('Join a guild voice channel and stream a direct .mp4 or .mkv URL')
    .requiredOption('--guild-id <snowflake>')
    .requiredOption('--channel-id <snowflake>')
    .requiredOption('--url <url>')
    .option('--mode <mode>', 'stream mode', 'go-live')
    .option('--json', 'accepted for compatibility; lifecycle output is always JSON', true)
    .action(async (options: Record<string, string | boolean>) => {
      const mode = options.mode;
      if (mode !== 'go-live') {
        throw new AppError('Only --mode go-live is supported in v1.', ExitCode.Config, { mode });
      }

      const spec: StreamJobSpec = {
        guildId: requireSnowflake(String(options.guildId), '--guild-id'),
        channelId: requireSnowflake(String(options.channelId), '--channel-id'),
        url: String(options.url),
        mode: 'go-live',
      };

      await runStreamJob(spec);
    });
}
