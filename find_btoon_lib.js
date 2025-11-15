#!/usr/bin/env node
/**
 * Helper script to find btoon-core library directory
 * Used by binding.gyp to locate btoon-core library
 */

const path = require('path');
const fs = require('fs');

// Try environment variable first
const coreLibDir = process.env.BTOON_CORE_LIB_DIR;
if (coreLibDir && fs.existsSync(coreLibDir)) {
  console.log(coreLibDir);
  process.exit(0);
}

// Try sibling directory (relative to this script)
const scriptDir = __dirname;
const siblingLibDir = path.resolve(scriptDir, '../btoon-core/build');
if (fs.existsSync(siblingLibDir)) {
  console.log(siblingLibDir);
  process.exit(0);
}

// Default system location
console.log('/usr/local/lib');
process.exit(0);

