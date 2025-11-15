#!/usr/bin/env node
/**
 * Helper script to find btoon-core include directory
 * Used by binding.gyp to locate btoon-core headers
 */

const path = require('path');
const fs = require('fs');

// Try environment variable first
const coreInclude = process.env.BTOON_CORE_INCLUDE;
if (coreInclude && fs.existsSync(coreInclude)) {
  console.log(coreInclude);
  process.exit(0);
}

// Try submodule location (relative to btoon-nodejs root)
const scriptDir = __dirname;
const submoduleInclude = path.resolve(scriptDir, 'core', 'include');
if (fs.existsSync(submoduleInclude)) {
  console.log(submoduleInclude);
  process.exit(0);
}

// Try sibling directory (relative to repo root)
const siblingInclude = path.resolve(scriptDir, '..', '..', 'btoon-core', 'include');
if (fs.existsSync(siblingInclude)) {
  console.log(siblingInclude);
  process.exit(0);
}

// Default: return empty string so other include_dirs entries are tried
console.log('');
process.exit(0);

