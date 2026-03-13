import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const originalRuntimeMethods = `-sEXPORTED_RUNTIME_METHODS='[\\"ccall\\"]'`;
const patchedRuntimeMethods = `-sEXPORTED_RUNTIME_METHODS='[\\"ccall\\",\\"HEAPU8\\",\\"wasmMemory\\"]'`;
const libdaveBuildDir = 'build';
const libdaveBuildType = 'Release';
const libdaveWasmManifestDir = 'vcpkg-alts/wasm';
const libdaveToolchainFile = 'vcpkg/scripts/buildsystems/vcpkg.cmake';

export function patchLibdaveCMakeContent(content) {
  if (content.includes(patchedRuntimeMethods)) {
    return content;
  }

  const patched = content.replace(originalRuntimeMethods, patchedRuntimeMethods);
  if (patched === content) {
    throw new Error(
      'Failed to patch libdave CMakeLists.txt: EXPORTED_RUNTIME_METHODS entry not found.'
    );
  }

  return patched;
}

export async function patchLibdaveCMakeLists(sourceDir) {
  const cmakeListsPath = path.join(sourceDir, 'cpp', 'CMakeLists.txt');
  const content = await readFile(cmakeListsPath, 'utf8');
  const patched = patchLibdaveCMakeContent(content);

  if (patched !== content) {
    await writeFile(cmakeListsPath, patched, 'utf8');
    console.log('[libdave patch] Added HEAPU8 and wasmMemory runtime exports.');
  }
}

export function getLibdaveEmscriptenToolchainFile(emsdk) {
  return path.join(
    emsdk,
    'upstream',
    'emscripten',
    'cmake',
    'Modules',
    'Platform',
    'Emscripten.cmake'
  );
}

export function getLibdaveWasmConfigureArgs(emsdk) {
  return [
    'cmake',
    `-B${libdaveBuildDir}`,
    `-DCMAKE_BUILD_TYPE=${libdaveBuildType}`,
    `-DVCPKG_MANIFEST_DIR=${libdaveWasmManifestDir}`,
    `-DCMAKE_TOOLCHAIN_FILE=${libdaveToolchainFile}`,
    `-DVCPKG_CHAINLOAD_TOOLCHAIN_FILE=${getLibdaveEmscriptenToolchainFile(emsdk)}`,
    '-DVCPKG_TARGET_TRIPLET=wasm32-emscripten',
  ];
}

export function getLibdaveWasmBuildArgs() {
  return ['--build', libdaveBuildDir, '--target', 'libdave', '--config', libdaveBuildType];
}
