// Locates btoon-core for binding.gyp: BTOON_CORE_DIR, the core/ submodule, or ../btoon-core.
// `node scripts/core-path.js include` prints the include dir, `src` the source dir, and
// `sources` the .cpp files the addon is built from.
'use strict';
const fs = require('fs');
const path = require('path');

// The addon needs core's codec, envelopes and HMAC, nothing else. Core's other modules
// (schema, streams, zero-copy and memory-mapped I/O, the C API, ...) aren't compiled, so they
// can't break a source build on a platform the addon otherwise supports, such as Android.
const SOURCES = ['btoon.cpp', 'internal.cpp', 'encoder.cpp', 'decoder.cpp', 'compression.cpp', 'security.cpp', 'sha256.cpp'];

const root = path.resolve(__dirname, '..');
const candidates = [process.env.BTOON_CORE_DIR, path.join(root, 'core'), path.join(root, '..', 'btoon-core')];
const core = candidates.find((c) => c && fs.existsSync(path.join(c, 'src', 'encoder.cpp')));
if (!core) {
  console.error('btoon: btoon-core sources not found. Run `git submodule update --init` or set BTOON_CORE_DIR.');
  process.exit(1);
}
const rel = (p) => path.relative(root, p).split(path.sep).join('/');
const what = process.argv[2];
if (what === 'include') {
  console.log(rel(path.join(core, 'include')));
} else if (what === 'src') {
  console.log(rel(path.join(core, 'src')));
} else {
  const missing = SOURCES.filter((f) => !fs.existsSync(path.join(core, 'src', f)));
  if (missing.length > 0) {
    console.error(`btoon: btoon-core at ${core} lacks ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log(SOURCES.map((f) => rel(path.join(core, 'src', f))).join(' '));
}
