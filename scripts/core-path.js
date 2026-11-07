// Locates btoon-core for binding.gyp: BTOON_CORE_DIR, the core/ submodule, or ../btoon-core.
// `node scripts/core-path.js include` prints the include dir; `sources` prints the .cpp files.
'use strict';
const fs = require('fs');
const path = require('path');

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
  const src = path.join(core, 'src');
  console.log(fs.readdirSync(src).filter((f) => f.endsWith('.cpp')).sort().map((f) => rel(path.join(src, f))).join(' '));
}
