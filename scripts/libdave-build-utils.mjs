import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const originalRuntimeMethods = `-sEXPORTED_RUNTIME_METHODS='[\\"ccall\\"]'`;
const patchedRuntimeMethods = `-sEXPORTED_RUNTIME_METHODS='[\\"ccall\\",\\"HEAPU8\\",\\"wasmMemory\\"]'`;

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
