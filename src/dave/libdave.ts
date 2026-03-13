import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AppError, ExitCode } from '../errors.js';
import { resolveDaveArtifactPaths } from './artifacts.js';
import type { DaveModule } from './types.js';

let cachedModule: DaveModule | null = null;

export async function loadDaveModule(): Promise<DaveModule> {
  if (cachedModule) {
    return cachedModule;
  }

  const currentModuleDir = path.dirname(fileURLToPath(import.meta.url));
  const { vendorDirectory, libdaveJavaScript, libdaveWasm } = await resolveDaveArtifactPaths({
    moduleDirectory: currentModuleDir,
  });

  const moduleUrl = pathToFileURL(libdaveJavaScript).href;
  const imported = (await import(moduleUrl)) as {
    default?: (options: unknown) => Promise<DaveModule>;
  };
  const factory = imported.default;

  if (!factory) {
    throw new AppError('libdave.js did not export a default module factory.', ExitCode.Dave);
  }

  const wasmBinary = await readFile(libdaveWasm);
  cachedModule = await factory({
    wasmBinary,
    locateFile: (filename: string) => path.join(vendorDirectory, filename),
  });

  return cachedModule;
}
