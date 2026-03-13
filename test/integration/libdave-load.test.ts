import { access } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { resolveDaveArtifactPaths } from '../../src/dave/artifacts.js';

const shouldRun = process.env.RUN_NATIVE_INTEGRATION === '1';

describe.skipIf(!shouldRun)('libdave integration', () => {
  test('official libdave artifacts exist before runtime integration starts', async () => {
    const { libdaveJavaScript, libdaveWasm } = await resolveDaveArtifactPaths({
      moduleDirectory: path.resolve(process.cwd(), 'src', 'dave'),
    });

    await expect(access(libdaveJavaScript)).resolves.toBeUndefined();
    await expect(access(libdaveWasm)).resolves.toBeUndefined();
  });
});
