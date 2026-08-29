ARG NODE_VERSION=26.7.0
ARG N8N_VERSION=snapshot

# The digest pins node:26.7.0-alpine3.24 for amd64 and arm64. Change the tag and the digest together.
ARG BUILDER_IMAGE=node:26.7.0-alpine3.24@sha256:aadf416b2cdce311a8811ba3f0608a61b77dbf997500e2eafe781b51f6a0b019
ARG RUNTIME_IMAGE=n8nio/base:26.7.0@sha256:33687300c4e94dc00f42ec79ae15082ae07330ecd82ae1167125905b65908ff8

# The runtime base has no compiler, so this stage supplies one.
FROM ${BUILDER_IMAGE} AS toolchain
RUN apk add --no-cache python3 make g++
# npm's bundled node-gyp is pinned to the image digest. `npx node-gyp` would
# fetch a different version at build time.
ENV NODE_GYP=/usr/local/lib/node_modules/npm/node_modules/node-gyp/bin/node-gyp.js

# Every native module is compiled here, above `COPY ./compiled`, so an
# application change does not start a new compile. Each module's own source is
# the only cache input.
FROM toolchain AS native-builder

# These are pnpm symlinks, so copy the target directories. The wildcards track
# the versions in the catalog. Each header package is copied through the
# symlink that sits beside its module, which pins the version pnpm resolved
# without a second wildcard that could match two majors.
COPY ./compiled/node_modules/.pnpm/isolated-vm@*/node_modules/isolated-vm /build/isolated-vm
WORKDIR /build/isolated-vm
# node-gyp-build reads /etc/alpine-release to detect musl. DHI Alpine has no such file,
# so the loader takes the glibc prebuild and crashes. Build from source instead.
# Call node-gyp directly: `npm rebuild` starts two builds that conflict.
RUN rm -rf prebuilds && node "$NODE_GYP" rebuild --release -j max

# sqlite3 resolves its build-time dependencies from the module directory, which
# is what the flat /build/node_modules layout is for: node-addon-api for the
# headers, and `tar` because a gyp action unpacks the bundled sqlite amalgamation
# with it. pnpm gives each of those its own store directory, so tar's own closure
# has to come across too. Copying each through the symlink beside its dependant
# pins the version pnpm resolved. A missing entry fails the build outright, and
# docker-build-smoke.yml rebuilds this chain with no cache on every PR that
# touches it.
COPY ./compiled/node_modules/.pnpm/sqlite3@*/node_modules/node-addon-api /build/node_modules/node-addon-api
COPY ./compiled/node_modules/.pnpm/sqlite3@*/node_modules/tar /build/node_modules/tar
COPY ./compiled/node_modules/.pnpm/tar@*/node_modules/@isaacs/fs-minipass /build/node_modules/@isaacs/fs-minipass
COPY ./compiled/node_modules/.pnpm/tar@*/node_modules/chownr /build/node_modules/chownr
COPY ./compiled/node_modules/.pnpm/tar@*/node_modules/minipass /build/node_modules/minipass
COPY ./compiled/node_modules/.pnpm/tar@*/node_modules/minizlib /build/node_modules/minizlib
COPY ./compiled/node_modules/.pnpm/tar@*/node_modules/yallist /build/node_modules/yallist
COPY ./compiled/node_modules/.pnpm/sqlite3@*/node_modules/sqlite3 /build/node_modules/sqlite3
WORKDIR /build/node_modules/sqlite3
RUN node "$NODE_GYP" rebuild --release

# The workspace install cannot build this binding, because CI installs on a Node version
# Confluent ships no prebuild for, so `./compiled` arrives without one. Compile it here
# and link against the runtime base's librdkafka. See: https://github.com/confluentinc/confluent-kafka-javascript/issues/397
RUN apk add --no-cache librdkafka-dev
COPY ./compiled/node_modules/.pnpm/@confluentinc+kafka-javascript@*/node_modules/nan /build/node_modules/nan
COPY ./compiled/node_modules/.pnpm/@confluentinc+kafka-javascript@*/node_modules/@confluentinc/kafka-javascript /build/node_modules/@confluentinc/kafka-javascript
WORKDIR /build/node_modules/@confluentinc/kafka-javascript
RUN BUILD_LIBRDKAFKA=0 node "$NODE_GYP" rebuild --release

FROM toolchain AS builder
COPY ./compiled /usr/local/lib/node_modules/n8n
# `bindings` and node-gyp-build both resolve build/Release, so only the compiled
# artifact has to come across.
COPY --from=native-builder /build/node_modules/sqlite3/build/Release/node_sqlite3.node \
     /usr/local/lib/node_modules/n8n/node_modules/sqlite3/build/Release/node_sqlite3.node
COPY --from=native-builder /build/isolated-vm/build/Release/isolated_vm.node \
     /usr/local/lib/node_modules/n8n/node_modules/isolated-vm/build/Release/isolated_vm.node
# kafka-javascript has no top-level symlink and its pnpm directory name carries a
# patch hash, so the destination has to be globbed by the shell.
COPY --from=native-builder /build/node_modules/@confluentinc/kafka-javascript/build/Release/confluent-kafka-javascript.node /tmp/
RUN set -e; \
    dest=$(echo /usr/local/lib/node_modules/n8n/node_modules/.pnpm/@confluentinc+kafka-javascript@*/node_modules/@confluentinc/kafka-javascript); \
    mkdir -p "$dest/build/Release"; \
    mv /tmp/confluent-kafka-javascript.node "$dest/build/Release/"
# node-gyp-build finds build/Release first. Delete the prebuilds to remove the glibc fallback.
RUN rm -rf /usr/local/lib/node_modules/n8n/node_modules/isolated-vm/prebuilds

# A separate workflow builds the base image, so a new base reaches this image only
# when you change the reference here (see BUILDER_IMAGE/RUNTIME_IMAGE above).
FROM ${RUNTIME_IMAGE}

ARG N8N_VERSION
ARG N8N_RELEASE_TYPE=dev
ARG IMAGE_DESCRIPTION="Workflow Automation Tool"
ENV NODE_ENV=production
ENV N8N_RELEASE_TYPE=${N8N_RELEASE_TYPE}
ENV SHELL=/bin/sh

WORKDIR /home/node

COPY --from=builder /usr/local/lib/node_modules/n8n /usr/local/lib/node_modules/n8n
COPY docker/images/n8n/docker-entrypoint.sh /

# The base keeps node in /usr/bin and has no /usr/local/bin. Make that directory for the symlink.
RUN mkdir -p /usr/local/bin && \
    ln -s /usr/local/lib/node_modules/n8n/bin/n8n /usr/local/bin/n8n && \
    mkdir -p /home/node/.n8n && \
    chown -R node:node /home/node && \
    rm -rf /root/.npm /tmp/*

EXPOSE 5678/tcp
USER node
ENTRYPOINT ["tini", "--", "/docker-entrypoint.sh"]

LABEL org.opencontainers.image.title="n8n" \
      org.opencontainers.image.description="${IMAGE_DESCRIPTION}" \
      org.opencontainers.image.source="https://github.com/n8n-io/n8n" \
      org.opencontainers.image.url="https://n8n.io" \
      org.opencontainers.image.version=${N8N_VERSION}
