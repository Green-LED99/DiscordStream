import { access } from 'node:fs/promises';
import path from 'node:path';
import { AppError, ExitCode } from '../errors.js';

export type DaveArtifactPaths = {
  vendorDirectory: string;
  libdaveJavaScript: string;
  libdaveWasm: string;
  attemptedDirectories: string[];
};

type ResolveDaveArtifactOptions = {
  moduleDirectory: string;
  cwd?: string;
  fileExists?: (filePath: string) => Promise<boolean>;
};

export async function resolveDaveArtifactPaths({
  moduleDirectory,
  cwd = process.cwd(),
  fileExists = defaultFileExists,
}: ResolveDaveArtifactOptions): Promise<DaveArtifactPaths> {
  const attemptedDirectories = uniqueDirectories([
    path.resolve(moduleDirectory, '../../vendor/libdave'),
    path.resolve(moduleDirectory, '../../../vendor/libdave'),
    path.resolve(cwd, 'vendor/libdave'),
  ]);

  for (const vendorDirectory of attemptedDirectories) {
    const libdaveJavaScript = path.join(vendorDirectory, 'libdave.js');
    const libdaveWasm = path.join(vendorDirectory, 'libdave.wasm');

    if ((await fileExists(libdaveJavaScript)) && (await fileExists(libdaveWasm))) {
      return {
        vendorDirectory,
        libdaveJavaScript,
        libdaveWasm,
        attemptedDirectories,
      };
    }
  }

  throw new AppError(
    'Missing libdave artifact: libdave.js/libdave.wasm. Run npm run build:libdave first.',
    ExitCode.Dave,
    {
      attemptedDirectories,
    }
  );
}

async function defaultFileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function uniqueDirectories(directories: string[]): string[] {
  return [...new Set(directories)];
}
