import { describe, expect, test } from 'vitest';
// @ts-expect-error test-only import of the untyped build helper script
import { patchLibdaveCMakeContent } from '../scripts/libdave-build-utils.mjs';

const originalContent = `
set(EXPORTS "-sEXPORT_ES6=1 -sEXPORT_NAME=DaveModuleFactory -sEXPORTED_RUNTIME_METHODS='[\\"ccall\\"]' -sEXPORTED_FUNCTIONS='[\\"_malloc\\", \\"_free\\"]'")
`;

describe('patchLibdaveCMakeContent', () => {
  test('adds HEAPU8 and wasmMemory to exported runtime methods', () => {
    const patched = patchLibdaveCMakeContent(originalContent);

    expect(patched).toContain(
      `-sEXPORTED_RUNTIME_METHODS='[\\"ccall\\",\\"HEAPU8\\",\\"wasmMemory\\"]'`
    );
  });

  test('is idempotent when the upstream content is already patched', () => {
    const patched = patchLibdaveCMakeContent(
      originalContent.replace(
        `-sEXPORTED_RUNTIME_METHODS='[\\"ccall\\"]'`,
        `-sEXPORTED_RUNTIME_METHODS='[\\"ccall\\",\\"HEAPU8\\",\\"wasmMemory\\"]'`
      )
    );

    expect(patched).toContain(
      `-sEXPORTED_RUNTIME_METHODS='[\\"ccall\\",\\"HEAPU8\\",\\"wasmMemory\\"]'`
    );
  });

  test('throws when the upstream export line is missing', () => {
    expect(() => patchLibdaveCMakeContent('set(EXPORTS "")')).toThrow(
      /EXPORTED_RUNTIME_METHODS entry not found/
    );
  });
});
