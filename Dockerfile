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
  && make wasm \
  && mkdir -p /opt/libdave/out \
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
