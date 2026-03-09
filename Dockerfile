FROM emscripten/emsdk:latest AS libdave-builder

RUN apt-get update \
  && apt-get install -y --no-install-recommends git make python3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/libdave
RUN git clone --depth=1 https://github.com/discord/libdave.git source

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

COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/vendor/libdave ./vendor/libdave
COPY --from=build /app/docs ./docs
COPY --from=build /app/README.md ./README.md

ENTRYPOINT ["node", "./dist/src/cli.js"]

