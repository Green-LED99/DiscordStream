import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { resolveDaveArtifactPaths } from '../src/dave/artifacts.js';
import { AppError, ExitCode } from '../src/errors.js';

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    })
  );
});

describe('resolveDaveArtifactPaths', () => {
  test('resolves artifacts from a source-style module directory', async () => {
    const workspaceRoot = await createWorkspace({
      moduleDirectory: ['src', 'dave'],
      vendorDirectory: ['vendor', 'libdave'],
    });

    const resolved = await resolveDaveArtifactPaths({
      moduleDirectory: path.join(workspaceRoot, 'src', 'dave'),
      cwd: path.join(workspaceRoot, 'other-cwd'),
    });

    expect(resolved.vendorDirectory).toBe(path.join(workspaceRoot, 'vendor', 'libdave'));
  });

  test('resolves artifacts from a dist-style module directory', async () => {
    const workspaceRoot = await createWorkspace({
      moduleDirectory: ['dist', 'src', 'dave'],
      vendorDirectory: ['vendor', 'libdave'],
    });

    const resolved = await resolveDaveArtifactPaths({
      moduleDirectory: path.join(workspaceRoot, 'dist', 'src', 'dave'),
      cwd: path.join(workspaceRoot, 'other-cwd'),
    });

    expect(resolved.vendorDirectory).toBe(path.join(workspaceRoot, 'vendor', 'libdave'));
  });

  test('falls back to process cwd when relative candidates do not exist', async () => {
    const moduleRoot = await mkdtemp(path.join(os.tmpdir(), 'discord-stream-dave-module-'));
    tempDirectories.push(moduleRoot);
    await mkdir(path.join(moduleRoot, 'isolated', 'dave'), { recursive: true });

    const cwdRoot = await createWorkspace({
      moduleDirectory: ['placeholder'],
      vendorDirectory: ['vendor', 'libdave'],
    });

    const resolved = await resolveDaveArtifactPaths({
      moduleDirectory: path.join(moduleRoot, 'isolated', 'dave'),
      cwd: cwdRoot,
    });

    expect(resolved.vendorDirectory).toBe(path.join(cwdRoot, 'vendor', 'libdave'));
  });

  test('throws a DAVE app error when no artifact pair can be found', async () => {
    const rootDirectory = await mkdtemp(path.join(os.tmpdir(), 'discord-stream-dave-missing-'));
    tempDirectories.push(rootDirectory);
    await mkdir(path.join(rootDirectory, 'src', 'dave'), { recursive: true });

    await expect(
      resolveDaveArtifactPaths({
        moduleDirectory: path.join(rootDirectory, 'src', 'dave'),
        cwd: rootDirectory,
      })
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.exitCode).toBe(ExitCode.Dave);
      expect(appError.details?.attemptedDirectories).toEqual(
        expect.arrayContaining([path.join(rootDirectory, 'vendor', 'libdave')])
      );
      return true;
    });
  });
});

async function createWorkspace({
  moduleDirectory,
  vendorDirectory,
}: {
  moduleDirectory: string[];
  vendorDirectory: string[];
}): Promise<string> {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), 'discord-stream-dave-'));
  tempDirectories.push(rootDirectory);

  await mkdir(path.join(rootDirectory, ...moduleDirectory), { recursive: true });
  const fullVendorDirectory = path.join(rootDirectory, ...vendorDirectory);
  await mkdir(fullVendorDirectory, { recursive: true });
  await writeFile(
    path.join(fullVendorDirectory, 'libdave.js'),
    'export default async function () { return {}; }\n'
  );
  await writeFile(path.join(fullVendorDirectory, 'libdave.wasm'), new Uint8Array([0]));

  return rootDirectory;
}
