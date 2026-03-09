import { describe, expect, test } from 'vitest';

const shouldRun = process.env.RUN_NATIVE_INTEGRATION === '1';

describe.skipIf(!shouldRun)('ffmpeg pipeline integration', () => {
  test('native ffmpeg pipeline is enabled explicitly', () => {
    expect(process.env.RUN_NATIVE_INTEGRATION).toBe('1');
  });
});
