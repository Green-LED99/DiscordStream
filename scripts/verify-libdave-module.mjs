import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const vendorDirectory = path.resolve(process.cwd(), 'vendor', 'libdave');
const libdaveJavaScript = path.join(vendorDirectory, 'libdave.js');
const libdaveWasm = path.join(vendorDirectory, 'libdave.wasm');

async function main() {
  await Promise.all([access(libdaveJavaScript), access(libdaveWasm)]).catch(() => {
    throw new Error(
      'Missing libdave artifacts. Run npm run build:libdave before verifying the module.'
    );
  });

  const moduleUrl = pathToFileURL(libdaveJavaScript).href;
  const imported = await import(moduleUrl);
  const factory = imported.default;

  if (typeof factory !== 'function') {
    throw new Error('libdave.js did not export a default module factory.');
  }

  const wasmBinary = await readFile(libdaveWasm);
  const dave = await factory({
    wasmBinary,
    locateFile: (filename) => path.join(vendorDirectory, filename),
  });

  const checks = [
    ['HEAPU8', dave.HEAPU8 instanceof Uint8Array, typeof dave.HEAPU8],
    [
      'wasmMemory',
      typeof dave.wasmMemory === 'object' && dave.wasmMemory !== null,
      typeof dave.wasmMemory,
    ],
    ['_malloc', typeof dave._malloc === 'function', typeof dave._malloc],
    ['_free', typeof dave._free === 'function', typeof dave._free],
    ['Encryptor', typeof dave.Encryptor === 'function', typeof dave.Encryptor],
    ['Decryptor', typeof dave.Decryptor === 'function', typeof dave.Decryptor],
    ['Session', typeof dave.Session === 'function', typeof dave.Session],
  ];

  let hasFailures = false;
  for (const [name, passed, actualType] of checks) {
    if (passed) {
      console.log(`✓ ${name}: ${actualType}`);
      continue;
    }

    hasFailures = true;
    console.error(`[ERROR] Critical export missing or wrong type: ${name}`);
    console.error(`  Expected: ${name === 'HEAPU8' ? 'object' : 'function/object'}`);
    console.error(`  Got: ${actualType}`);
  }

  if (hasFailures) {
    process.exitCode = 1;
    return;
  }

  console.log('[SUCCESS] All required libdave exports verified.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
