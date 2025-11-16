// Use node-gyp-build to load the prebuilt binary or built addon
// This works without install scripts (compatible with pnpm, Vercel, etc.)
const btoon = require('node-gyp-build')(__dirname);

module.exports = btoon;
