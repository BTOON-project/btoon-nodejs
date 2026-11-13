#!/bin/sh
# Installs a packed btoon tarball the way users do, minus install scripts (so nothing gets
# compiled), then loads it and round-trips a document: the prebuild for this libc and
# architecture has to load as shipped. Runs inside a distro image:
#
#   docker run --rm -v "$PWD/btoon.tgz:/pkg/btoon.tgz:ro" -v "$PWD/scripts/load-test.sh:/load-test.sh:ro" \
#     [-v "$NODE_DIR:/opt/node:ro"] IMAGE sh /load-test.sh /pkg/btoon.tgz
#
# Uses the image's Node.js, or the one mounted at /opt/node (scripts/fetch-node.sh) if it has none.
set -eu
pkg=${1:?usage: load-test.sh PACKAGE.tgz}
command -v node >/dev/null 2>&1 || PATH=/opt/node/bin:$PATH
cd "$(mktemp -d)"
npm init -y >/dev/null
npm install --ignore-scripts --no-audit --no-fund "$pkg" >/dev/null
node - <<'EOF'
'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const btoon = require('btoon');
const dir = path.dirname(require.resolve('btoon/package.json'));
const binary = require('node-gyp-build').path(dir);
assert.ok(binary.includes(`${path.sep}prebuilds${path.sep}`), `loaded ${binary}, not a prebuild`);
const rows = Array.from({ length: 50 }, (_, i) => ({ id: i, name: `user${i}`, score: i / 4, active: i % 2 === 0 }));
const value = { rows, when: new Date(Date.UTC(2026, 10, 13)), big: 2n ** 70n, bytes: Buffer.from([1, 2, 3]), vector: new Float32Array([1.5, -2]) };
for (const options of [{}, { compress: true }, { hmacKey: 'k'.repeat(32) }]) {
  assert.deepStrictEqual(btoon.decode(btoon.encode(value, options), { hmacKey: options.hmacKey }), value);
}
const { glibcVersionRuntime } = process.report.getReport().header;
const libc = glibcVersionRuntime ? `glibc ${glibcVersionRuntime}` : 'musl';
console.log(`ok: btoon ${btoon.VERSION} (${path.relative(dir, binary)}) on Node.js ${process.version}, ${libc}, ${process.arch}`);
EOF
