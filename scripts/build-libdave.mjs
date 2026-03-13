import { spawn } from 'node:child_process';
import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  getLibdaveWasmBuildArgs,
  getLibdaveWasmConfigureArgs,
  patchLibdaveCMakeLists,
} from './libdave-build-utils.mjs';

const rootDir = process.cwd();
const sourceDir = path.join(rootDir, 'vendor', 'libdave-src');
const outputDir = path.join(rootDir, 'vendor', 'libdave');

async function run(command, args, cwd, env = process.env) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: 'inherit',
    });

    child.once('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}`));
    });
  });
}

async function main() {
  if (!process.env.EMSDK) {
    throw new Error('EMSDK must be set before running build-libdave.');
  }
  const emcmake = path.join(process.env.EMSDK, 'upstream', 'emscripten', 'emcmake');

  await rm(sourceDir, { recursive: true, force: true });
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(path.dirname(sourceDir), { recursive: true });
  await mkdir(outputDir, { recursive: true });

  await run(
    'git',
    ['clone', '--depth=1', 'https://github.com/discord/libdave.git', sourceDir],
    rootDir
  );
  await patchLibdaveCMakeLists(sourceDir);
  await run('git', ['submodule', 'update', '--init', '--recursive'], sourceDir);
  await run(emcmake, getLibdaveWasmConfigureArgs(process.env.EMSDK), path.join(sourceDir, 'cpp'));
  await run('cmake', getLibdaveWasmBuildArgs(), path.join(sourceDir, 'cpp'));

  await cp(path.join(sourceDir, 'cpp', 'build', 'libdave.js'), path.join(outputDir, 'libdave.js'));
  await cp(
    path.join(sourceDir, 'cpp', 'build', 'libdave.wasm'),
    path.join(outputDir, 'libdave.wasm')
  );
  await cp(
    path.join(sourceDir, 'cpp', 'build', 'libdave.d.ts'),
    path.join(outputDir, 'libdave.d.ts')
  );
  await run(process.execPath, ['scripts/verify-libdave-module.mjs'], rootDir);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
