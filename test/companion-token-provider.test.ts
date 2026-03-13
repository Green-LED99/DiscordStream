import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  parseCompanionTokenProviderConfig,
  resolveCompanionToken,
} from '../src/companion-token-provider.js';
import { AppError, ExitCode } from '../src/errors.js';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    })
  );
  process.env.DISCORD_COMPANION_TOKEN = undefined;
});

describe('parseCompanionTokenProviderConfig', () => {
  test('uses an explicit env provider', () => {
    const provider = parseCompanionTokenProviderConfig({
      DISCORD_COMPANION_TOKEN_PROVIDER: 'env',
      DISCORD_COMPANION_TOKEN: 'token',
    });

    expect(provider).toEqual({
      kind: 'env',
      envVar: 'DISCORD_COMPANION_TOKEN',
    });
  });

  test('uses an explicit file provider', () => {
    const provider = parseCompanionTokenProviderConfig({
      DISCORD_COMPANION_TOKEN_PROVIDER: 'file',
      DISCORD_COMPANION_TOKEN_FILE: './secret/token.txt',
    });

    expect(provider).toEqual({
      kind: 'file',
      path: './secret/token.txt',
    });
  });

  test('uses an explicit command provider with timeout override', () => {
    const provider = parseCompanionTokenProviderConfig({
      DISCORD_COMPANION_TOKEN_PROVIDER: 'command',
      DISCORD_COMPANION_TOKEN_COMMAND: 'printf token',
      DISCORD_COMPANION_TOKEN_COMMAND_TIMEOUT_MS: '7500',
    });

    expect(provider).toEqual({
      kind: 'command',
      command: 'printf token',
      timeoutMs: 7_500,
    });
  });

  test('infers the env provider when it is the only configured source', () => {
    const provider = parseCompanionTokenProviderConfig({
      DISCORD_COMPANION_TOKEN: 'token',
    });

    expect(provider.kind).toBe('env');
  });

  test('infers the file provider when it is the only configured source', () => {
    const provider = parseCompanionTokenProviderConfig({
      DISCORD_COMPANION_TOKEN_FILE: './token.txt',
    });

    expect(provider).toEqual({
      kind: 'file',
      path: './token.txt',
    });
  });

  test('rejects missing provider sources', () => {
    expect(() => parseCompanionTokenProviderConfig({})).toThrow(AppError);
  });

  test('rejects multiple inferred provider sources', () => {
    expect(() =>
      parseCompanionTokenProviderConfig({
        DISCORD_COMPANION_TOKEN: 'token',
        DISCORD_COMPANION_TOKEN_FILE: './token.txt',
      })
    ).toThrow(AppError);
  });

  test('rejects an explicit provider with no matching value', () => {
    expect(() =>
      parseCompanionTokenProviderConfig({
        DISCORD_COMPANION_TOKEN_PROVIDER: 'command',
      })
    ).toThrow(AppError);
  });

  test('rejects an invalid command timeout', () => {
    expect(() =>
      parseCompanionTokenProviderConfig({
        DISCORD_COMPANION_TOKEN_PROVIDER: 'command',
        DISCORD_COMPANION_TOKEN_COMMAND: 'printf token',
        DISCORD_COMPANION_TOKEN_COMMAND_TIMEOUT_MS: '0',
      })
    ).toThrow(AppError);
  });
});

describe('resolveCompanionToken', () => {
  test('resolves a trimmed env token', async () => {
    process.env.DISCORD_COMPANION_TOKEN = ' token \n';

    await expect(
      resolveCompanionToken({
        kind: 'env',
        envVar: 'DISCORD_COMPANION_TOKEN',
      })
    ).resolves.toBe('token');
  });

  test('resolves a trimmed file token', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'discord-stream-token-file-'));
    tempDirectories.push(directory);
    const tokenPath = path.join(directory, 'token.txt');
    await writeFile(tokenPath, ' token \n');

    await expect(
      resolveCompanionToken({
        kind: 'file',
        path: tokenPath,
      })
    ).resolves.toBe('token');
  });

  test('resolves a trimmed command token', async () => {
    await expect(
      resolveCompanionToken({
        kind: 'command',
        command: "printf ' token\\n'",
        timeoutMs: 1_000,
      })
    ).resolves.toBe('token');
  });

  test('rejects empty file output', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'discord-stream-token-empty-'));
    tempDirectories.push(directory);
    const tokenPath = path.join(directory, 'token.txt');
    await writeFile(tokenPath, '\n');

    await expect(
      resolveCompanionToken({
        kind: 'file',
        path: tokenPath,
      })
    ).rejects.toMatchObject({
      exitCode: ExitCode.Config,
    });
  });

  test('rejects empty command output', async () => {
    await expect(
      resolveCompanionToken({
        kind: 'command',
        command: 'printf ""',
        timeoutMs: 1_000,
      })
    ).rejects.toMatchObject({
      exitCode: ExitCode.Config,
    });
  });

  test('rejects command timeout', async () => {
    await expect(
      resolveCompanionToken({
        kind: 'command',
        command: 'sleep 1',
        timeoutMs: 10,
      })
    ).rejects.toMatchObject({
      exitCode: ExitCode.Config,
      details: expect.objectContaining({
        provider: 'command',
        timeoutMs: 10,
      }),
    });
  });

  test('rejects command failure', async () => {
    await expect(
      resolveCompanionToken({
        kind: 'command',
        command: 'exit 7',
        timeoutMs: 1_000,
      })
    ).rejects.toMatchObject({
      exitCode: ExitCode.Config,
      details: expect.objectContaining({
        provider: 'command',
        exitCode: 7,
      }),
    });
  });
});
