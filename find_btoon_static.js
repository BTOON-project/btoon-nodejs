#!/usr/bin/env node
const path = require('path');
const fs = require('fs');

// Try core/build first (submodule location) - relative to build/ directory
const coreSubmodule = path.join('..', 'core', 'build', 'libbtoon_core.a');
if (fs.existsSync(path.resolve(__dirname, 'core', 'build', 'libbtoon_core.a'))) {
  console.log(coreSubmodule);
  process.exit(0);
}

// Try sibling directory - relative to build/ directory
const coreSibling = path.join('..', '..', 'btoon-core', 'build', 'libbtoon_core.a');
if (fs.existsSync(path.resolve(__dirname, '..', 'btoon-core', 'build', 'libbtoon_core.a'))) {
  console.log(coreSibling);
  process.exit(0);
}

// Try /usr/local/lib (system install)
const systemLib = '/usr/local/lib/libbtoon_core.a';
if (fs.existsSync(systemLib)) {
  console.log(systemLib);
  process.exit(0);
}

// Return empty - will cause link error
console.log('');
process.exit(0);
