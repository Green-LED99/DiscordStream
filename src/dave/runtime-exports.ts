import { AppError, ExitCode } from '../errors.js';
import type { DaveModule } from './types.js';

export function getDaveHeapU8(dave: DaveModule): Uint8Array {
  if (dave.HEAPU8 instanceof Uint8Array) {
    return dave.HEAPU8;
  }

  throw new AppError(
    'libdave module did not expose HEAPU8. Rebuild libdave with npm run build:libdave.',
    ExitCode.Dave,
    {
      hasHeapU8: typeof dave.HEAPU8 !== 'undefined',
      hasWasmMemory: typeof dave.wasmMemory !== 'undefined',
    }
  );
}
