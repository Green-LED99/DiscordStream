FROM emscripten/emsdk:latest AS libdave-builder

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    cmake \
    git \
    make \
    ninja-build \
    pkg-config \
    python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/libdave
RUN git clone --depth=1 https://github.com/discord/libdave.git source
RUN python3 - <<'PY'
from pathlib import Path

cmakelists = Path('/opt/libdave/source/cpp/CMakeLists.txt')
content = cmakelists.read_text()
original = '-sEXPORTED_RUNTIME_METHODS=\'[\\"ccall\\"]\''
patched = '-sEXPORTED_RUNTIME_METHODS=\'[\\"ccall\\",\\"HEAPU8\\",\\"wasmMemory\\"]\''

if patched not in content:
    if original not in content:
        raise SystemExit('Failed to patch libdave CMakeLists.txt: EXPORTED_RUNTIME_METHODS entry not found.')
    content = content.replace(original, patched)
    cmakelists.write_text(content)
PY

WORKDIR /opt/libdave/source
RUN git submodule update --init --recursive

WORKDIR /opt/libdave/source/cpp
RUN . "$EMSDK/emsdk_env.sh" \
  && /emsdk/upstream/emscripten/emcmake /usr/bin/cmake -Bbuild \
    -DCMAKE_BUILD_TYPE=Release \
    -DVCPKG_MANIFEST_DIR=vcpkg-alts/wasm \
    -DCMAKE_TOOLCHAIN_FILE=vcpkg/scripts/buildsystems/vcpkg.cmake \
    -DVCPKG_CHAINLOAD_TOOLCHAIN_FILE="$EMSDK/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake" \
    -DVCPKG_TARGET_TRIPLET=wasm32-emscripten \
  && /usr/bin/cmake --build build --target libdave --config Release \
  && node --input-type=module - <<'JS'
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const buildDir = '/opt/libdave/source/cpp/build';
const libdaveJavaScript = path.join(buildDir, 'libdave.js');
const libdaveWasm = path.join(buildDir, 'libdave.wasm');
const moduleUrl = pathToFileURL(libdaveJavaScript).href;
const imported = await import(moduleUrl);
const factory = imported.default;

if (typeof factory !== 'function') {
  throw new Error('libdave.js did not export a default module factory.');
}

const wasmBinary = await readFile(libdaveWasm);
const dave = await factory({
  wasmBinary,
  locateFile: (filename) => path.join(buildDir, filename),
});

const checks = [
  ['HEAPU8', dave.HEAPU8 instanceof Uint8Array],
  ['wasmMemory', typeof dave.wasmMemory === 'object' && dave.wasmMemory !== null],
  ['_malloc', typeof dave._malloc === 'function'],
  ['_free', typeof dave._free === 'function'],
  ['Encryptor', typeof dave.Encryptor === 'function'],
  ['Decryptor', typeof dave.Decryptor === 'function'],
  ['Session', typeof dave.Session === 'function'],
];

for (const [name, passed] of checks) {
  if (!passed) {
    throw new Error(`Built libdave artifact is missing required export: ${name}`);
  }
}
JS
RUN mkdir -p /opt/libdave/out \
  && cp build/libdave.js /opt/libdave/out/libdave.js \
  && cp build/libdave.wasm /opt/libdave/out/libdave.wasm \
  && cp build/libdave.d.ts /opt/libdave/out/libdave.d.ts

FROM node:22-bookworm AS build

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

COPY . .
COPY --from=libdave-builder /opt/libdave/out ./vendor/libdave

RUN npm run build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/vendor/libdave ./vendor/libdave
COPY --from=build /app/docs ./docs
COPY --from=build /app/README.md ./README.md

ENTRYPOINT ["node", "./dist/src/cli.js"]
