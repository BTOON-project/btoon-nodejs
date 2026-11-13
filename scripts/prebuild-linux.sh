#!/usr/bin/env bash
# Builds the Linux glibc prebuild (prebuilds/linux-<arch>/btoon.node) inside a manylinux_2_28
# image: AlmaLinux 8 with glibc 2.28, the floor of Node.js's own Linux builds. Its gcc-toolset
# links the libstdc++ symbols that are newer than GCC 8 statically, so the binary needs at most
# GLIBCXX_3.4.25 and loads on RHEL 8+, Debian 10+, Ubuntu 20.04+ and Amazon Linux 2023.
# Built on ubuntu-24.04 instead, it needed GLIBC_2.38 and GLIBCXX_3.4.32.
#
# Installs Node.js from nodejs.org, builds, checks the symbol versions, and runs the tests
# against the prebuild:
#
#   docker run --rm -v "$PWD:/work" -w /work quay.io/pypa/manylinux_2_28_x86_64 bash scripts/prebuild-linux.sh
#   docker run --rm -v "$PWD:/work" -w /work quay.io/pypa/manylinux_2_28_aarch64 bash scripts/prebuild-linux.sh
set -euo pipefail
cd "$(dirname "$0")/.."

bash scripts/fetch-node.sh /tmp/node "${NODE_MAJOR:-22}"
export PATH="/tmp/node/bin:$PATH"

npm install --ignore-scripts --no-audit --no-fund
npx prebuildify --napi --strip --target 18.0.0
bash scripts/check-glibc.sh prebuilds/linux-*/btoon.node
rm -rf build
npm test
