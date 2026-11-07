// ESM entry point. The native addon is loaded through the CommonJS module.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const btoon = require('./index.js');

export const { encode, decode, encodeAsync, decodeAsync, compressionAvailable, BtoonError, Ext, Timestamp, VERSION, SPEC_VERSION } = btoon;
export default btoon;
