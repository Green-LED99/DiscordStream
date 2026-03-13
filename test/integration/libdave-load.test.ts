import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, test } from 'vitest';
import { resolveDaveArtifactPaths } from '../../src/dave/artifacts.js';

const shouldRun = process.env.RUN_NATIVE_INTEGRATION === '1';
const execFileAsync = promisify(execFile);

describe.skipIf(!shouldRun)('libdave integration', () => {
  test('official libdave artifacts exist before runtime integration starts', async () => {
    const { libdaveJavaScript, libdaveWasm } = await resolveDaveArtifactPaths({
      moduleDirectory: path.resolve(process.cwd(), 'src', 'dave'),
    });

    await expect(access(libdaveJavaScript)).resolves.toBeUndefined();
    await expect(access(libdaveWasm)).resolves.toBeUndefined();
  });

  test('verification script confirms the built module exports heap access', async () => {
    await expect(
      execFileAsync(process.execPath, ['scripts/verify-libdave-module.mjs'], {
        cwd: process.cwd(),
      })
    ).resolves.toMatchObject({
      stdout: expect.stringContaining('[SUCCESS]'),
    });
  });
});
