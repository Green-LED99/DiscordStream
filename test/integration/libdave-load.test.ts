import { access } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const artifactPath = path.resolve(process.cwd(), 'vendor', 'libdave', 'libdave.js');
const shouldRun = process.env.RUN_NATIVE_INTEGRATION === '1';

describe.skipIf(!shouldRun)('libdave integration', () => {
  test('official libdave artifacts exist before runtime integration starts', async () => {
    await expect(access(artifactPath)).resolves.toBeUndefined();
  });
});
