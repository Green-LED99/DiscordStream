import { access } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AppError, ExitCode } from '../errors.js';
import type { DaveModule } from './types.js';

const vendorDirectory = path.resolve(process.cwd(), 'vendor', 'libdave');
const libdaveJavaScript = path.join(vendorDirectory, 'libdave.js');
const libdaveWasm = path.join(vendorDirectory, 'libdave.wasm');

let cachedModule: DaveModule | null = null;

export async function loadDaveModule(): Promise<DaveModule> {
  if (cachedModule) {
    return cachedModule;
  }

  await Promise.all([ensureArtifactExists(libdaveJavaScript), ensureArtifactExists(libdaveWasm)]);

  const moduleUrl = pathToFileURL(libdaveJavaScript).href;
  const imported = (await import(moduleUrl)) as {
    default?: (options: unknown) => Promise<DaveModule>;
  };
  const factory = imported.default;

  if (!factory) {
    throw new AppError('libdave.js did not export a default module factory.', ExitCode.Dave);
  }

  cachedModule = await factory({
    locateFile: (filename: string) => path.join(vendorDirectory, filename),
  });

  return cachedModule;
}

async function ensureArtifactExists(filePath: string): Promise<void> {
  try {
    await access(filePath);
  } catch {
    throw new AppError(
      `Missing libdave artifact: ${path.basename(filePath)}. Run npm run build:libdave first.`,
      ExitCode.Dave,
      { filePath }
    );
  }
}
