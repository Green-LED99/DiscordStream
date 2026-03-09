import { pathToFileURL } from 'node:url';
import { Command } from 'commander';
import { registerPlayUrlCommand } from './commands/play-url.js';
import { toAppError } from './errors.js';
import { LifecycleReporter } from './lifecycle.js';

export function buildProgram(): Command {
  const program = new Command();
  program.name('discord-stream').description('Companion Discord video streamer CLI');
  registerPlayUrlCommand(program);
  return program;
}

export async function runCli(argv = process.argv): Promise<void> {
  const program = buildProgram();
  const lifecycle = new LifecycleReporter();

  try {
    await program.parseAsync(argv);
  } catch (error) {
    const appError = toAppError(error);
    lifecycle.emit('failed', {
      message: appError.message,
      exitCode: appError.exitCode,
      ...appError.details,
    });
    process.exitCode = appError.exitCode;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runCli();
}
