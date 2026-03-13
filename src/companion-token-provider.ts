import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { AppError, ExitCode } from './errors.js';

const execFileAsync = promisify(execFile);
const DEFAULT_COMMAND_TIMEOUT_MS = 5_000;
const ENV_TOKEN_PROVIDER = 'DISCORD_COMPANION_TOKEN';
const FILE_TOKEN_PROVIDER = 'DISCORD_COMPANION_TOKEN_FILE';
const COMMAND_TOKEN_PROVIDER = 'DISCORD_COMPANION_TOKEN_COMMAND';
const TOKEN_PROVIDER_KIND = 'DISCORD_COMPANION_TOKEN_PROVIDER';
const COMMAND_TIMEOUT_PROVIDER = 'DISCORD_COMPANION_TOKEN_COMMAND_TIMEOUT_MS';

export type CompanionTokenProviderConfig =
  | {
      kind: 'env';
      envVar: string;
    }
  | {
      kind: 'file';
      path: string;
    }
  | {
      kind: 'command';
      command: string;
      timeoutMs: number;
    };

export function parseCompanionTokenProviderConfig(
  env: NodeJS.ProcessEnv = process.env
): CompanionTokenProviderConfig {
  const explicitProvider = env[TOKEN_PROVIDER_KIND]?.trim();

  if (explicitProvider) {
    return parseExplicitProvider(explicitProvider, env);
  }

  const inferred = [
    hasValue(env[ENV_TOKEN_PROVIDER]) ? 'env' : null,
    hasValue(env[FILE_TOKEN_PROVIDER]) ? 'file' : null,
    hasValue(env[COMMAND_TOKEN_PROVIDER]) ? 'command' : null,
  ].filter((provider): provider is 'env' | 'file' | 'command' => provider !== null);

  if (inferred.length === 0) {
    throw new AppError(
      `Set one of ${ENV_TOKEN_PROVIDER}, ${FILE_TOKEN_PROVIDER}, or ${COMMAND_TOKEN_PROVIDER}.`,
      ExitCode.Config
    );
  }

  if (inferred.length > 1) {
    throw new AppError(
      `Set ${TOKEN_PROVIDER_KIND} when more than one companion token source is configured.`,
      ExitCode.Config,
      {
        configuredProviders: inferred,
      }
    );
  }

  const inferredProvider = inferred[0];
  if (!inferredProvider) {
    throw new AppError('No companion token provider could be inferred.', ExitCode.Config);
  }

  return parseExplicitProvider(inferredProvider, env);
}

export async function resolveCompanionToken(
  provider: CompanionTokenProviderConfig
): Promise<string> {
  switch (provider.kind) {
    case 'env':
      return normalizeToken(process.env[provider.envVar], {
        provider: provider.kind,
        envVar: provider.envVar,
      });
    case 'file': {
      const resolvedPath = path.resolve(process.cwd(), provider.path);
      let token: string;

      try {
        token = await readFile(resolvedPath, 'utf8');
      } catch {
        throw new AppError('Failed to read the companion token file.', ExitCode.Config, {
          provider: provider.kind,
          filePath: resolvedPath,
        });
      }

      return normalizeToken(token, {
        provider: provider.kind,
        filePath: resolvedPath,
      });
    }
    case 'command':
      return resolveTokenFromCommand(provider.command, provider.timeoutMs);
  }
}

async function resolveTokenFromCommand(command: string, timeoutMs: number): Promise<string> {
  try {
    const { stdout } = await execFileAsync('/bin/sh', ['-lc', command], {
      timeout: timeoutMs,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    });

    return normalizeToken(stdout, {
      provider: 'command',
      timeoutMs,
    });
  } catch (error) {
    const execError = error as NodeJS.ErrnoException & {
      killed?: boolean;
      signal?: NodeJS.Signals;
      code?: string | number;
    };

    if (execError.killed || execError.signal === 'SIGTERM') {
      throw new AppError('The companion token command timed out.', ExitCode.Config, {
        provider: 'command',
        timeoutMs,
      });
    }

    throw new AppError('The companion token command failed.', ExitCode.Config, {
      provider: 'command',
      exitCode: typeof execError.code === 'number' ? execError.code : null,
      timeoutMs,
    });
  }
}

function parseExplicitProvider(
  provider: string,
  env: NodeJS.ProcessEnv
): CompanionTokenProviderConfig {
  switch (provider) {
    case 'env':
      requireValue(ENV_TOKEN_PROVIDER, env[ENV_TOKEN_PROVIDER]);
      return {
        kind: 'env',
        envVar: ENV_TOKEN_PROVIDER,
      };
    case 'file':
      return {
        kind: 'file',
        path: requireValue(FILE_TOKEN_PROVIDER, env[FILE_TOKEN_PROVIDER]),
      };
    case 'command':
      return {
        kind: 'command',
        command: requireValue(COMMAND_TOKEN_PROVIDER, env[COMMAND_TOKEN_PROVIDER]),
        timeoutMs: parseCommandTimeout(env[COMMAND_TIMEOUT_PROVIDER]),
      };
    default:
      throw new AppError(
        `${TOKEN_PROVIDER_KIND} must be one of: env, file, command.`,
        ExitCode.Config,
        {
          provider,
        }
      );
  }
}

function parseCommandTimeout(value: string | undefined): number {
  if (!hasValue(value)) {
    return DEFAULT_COMMAND_TIMEOUT_MS;
  }

  const timeoutValue = requireValue(COMMAND_TIMEOUT_PROVIDER, value);
  const parsed = Number.parseInt(timeoutValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new AppError(
      `${COMMAND_TIMEOUT_PROVIDER} must be a positive integer in milliseconds.`,
      ExitCode.Config,
      {
        value,
      }
    );
  }

  return parsed;
}

function requireValue(name: string, value: string | undefined): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AppError(`${name} is required.`, ExitCode.Config);
  }

  return value.trim();
}

function hasValue(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeToken(value: string | undefined, details: Record<string, unknown>): string {
  const token = value?.trim();
  if (!token) {
    throw new AppError('The companion token provider returned an empty token.', ExitCode.Config, {
      ...details,
    });
  }

  return token;
}
