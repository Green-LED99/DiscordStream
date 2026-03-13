import { describe, expect, test } from 'vitest';
import {
  getLibdaveEmscriptenToolchainFile,
  getLibdaveWasmBuildArgs,
  getLibdaveWasmConfigureArgs,
  patchLibdaveCMakeContent,
} from '../scripts/libdave-build-utils.mjs';

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

describe('libdave wasm build command helpers', () => {
  test('matches the upstream emcmake configure arguments', () => {
    const emsdk = '/opt/emsdk';

    expect(getLibdaveWasmConfigureArgs(emsdk)).toEqual([
      'cmake',
      '-Bbuild',
      '-DCMAKE_BUILD_TYPE=Release',
      '-DVCPKG_MANIFEST_DIR=vcpkg-alts/wasm',
      '-DCMAKE_TOOLCHAIN_FILE=vcpkg/scripts/buildsystems/vcpkg.cmake',
      `-DVCPKG_CHAINLOAD_TOOLCHAIN_FILE=${getLibdaveEmscriptenToolchainFile(emsdk)}`,
      '-DVCPKG_TARGET_TRIPLET=wasm32-emscripten',
    ]);
  });

  test('matches the upstream cmake build command', () => {
    expect(getLibdaveWasmBuildArgs()).toEqual([
      '--build',
      'build',
      '--target',
      'libdave',
      '--config',
      'Release',
    ]);
  });
});
