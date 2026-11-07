'use strict';
/**
 * btoon — BTOON for Node.js (native, via Node-API).
 * The API matches @btoon/js, the pure JavaScript implementation.
 */

// Loads the prebuilt binary for this platform (prebuilds/) or a local build (build/).
const native = require('node-gyp-build')(__dirname);

const VERSION = '0.1.0';
const SPEC_VERSION = native.specVersion;

/** Error thrown for invalid BTOON data or values that can't be encoded. `code` is a spec error code. */
class BtoonError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BtoonError';
    this.code = code;
  }
}

/** An extension value BTOON doesn't interpret: `type` in -128..127 plus raw bytes. */
class Ext {
  constructor(type, data) {
    if (!Number.isInteger(type) || type < -128 || type > 127) {
      throw new RangeError('Ext type must be an integer in -128..127');
    }
    this.type = type;
    this.data = data instanceof Uint8Array ? data : new Uint8Array(data);
  }
}

/** A timestamp with nanosecond precision and an optional UTC offset (minutes). */
class Timestamp {
  constructor(seconds, nanoseconds = 0, offsetMinutes = undefined) {
    this.seconds = BigInt(seconds);
    if (!Number.isInteger(nanoseconds) || nanoseconds < 0 || nanoseconds >= 1e9) {
      throw new RangeError('nanoseconds must be an integer in [0, 1e9)');
    }
    if (offsetMinutes !== undefined && (!Number.isInteger(offsetMinutes) || Math.abs(offsetMinutes) > 1080)) {
      throw new RangeError('offsetMinutes must be an integer within ±1080');
    }
    this.nanoseconds = nanoseconds;
    this.offsetMinutes = offsetMinutes;
  }

  /** Millisecond-precision Date for this instant. */
  toDate() {
    return new Date(Number(this.seconds) * 1000 + Math.floor(this.nanoseconds / 1e6));
  }

  static fromDate(date) {
    const ms = date.getTime();
    if (!Number.isFinite(ms)) throw new RangeError('invalid Date');
    const seconds = Math.floor(ms / 1000);
    return new Timestamp(seconds, (ms - seconds * 1000) * 1e6);
  }
}

native.setup({ BtoonError, Ext, Timestamp, Map, arrayFrom: Array.from, objectPrototype: Object.prototype });

const ALGORITHMS = new Set(['zlib', 'lz4', 'zstd', 'brotli', 'snappy', 'auto']);

function keyBytes(key) {
  if (key === undefined || key === null) return undefined;
  let bytes;
  if (typeof key === 'string') bytes = Buffer.from(key, 'utf8');
  else if (key instanceof Uint8Array) bytes = key;
  else throw new BtoonError('invalid_argument', 'hmacKey must be a string or Uint8Array');
  // An empty key is a misconfiguration, not "no key" (spec §8): never silently skip verification.
  if (bytes.length === 0) throw new BtoonError('invalid_argument', 'hmacKey must not be empty (omit it for no key)');
  return bytes;
}

function depth(value, name) {
  if (value === undefined) return 128;
  if (!Number.isInteger(value) || value < 1) throw new BtoonError('invalid_argument', `${name} must be a positive integer`);
  return value;
}

function encodeOptions(o = {}) {
  const compression = o.compression ?? 'zlib';
  if (!ALGORITHMS.has(compression)) {
    throw new BtoonError('invalid_argument', `unknown compression algorithm: '${compression}'`);
  }
  return {
    compress: Boolean(o.compress),
    compression,
    autoTabular: o.autoTabular !== false,
    maxDepth: depth(o.maxDepth, 'maxDepth'),
    hmacKey: keyBytes(o.hmacKey),
  };
}

function decodeOptions(o = {}) {
  const timestamps = o.timestamps ?? 'date';
  const bigint = o.bigint ?? 'auto';
  if (timestamps !== 'date' && timestamps !== 'object') {
    throw new BtoonError('invalid_argument', "timestamps must be 'date' or 'object'");
  }
  if (bigint !== 'auto' && bigint !== 'always') throw new BtoonError('invalid_argument', "bigint must be 'auto' or 'always'");
  const max = o.maxDecompressedSize ?? 256 * 1024 * 1024;
  if (!Number.isSafeInteger(max) || max < 0) throw new BtoonError('invalid_argument', 'maxDecompressedSize must be a non-negative integer');
  return {
    strict: o.strict !== false,
    maxDepth: depth(o.maxDepth, 'maxDepth'),
    maxDecompressedSize: max,
    autoDecompress: o.autoDecompress !== false,
    hmacKey: keyBytes(o.hmacKey),
    timestamps,
    bigint,
  };
}

/** Encodes a value to canonical BTOON. Returns a Buffer (a Uint8Array). */
function encode(value, options) {
  return native.encode(value, encodeOptions(options));
}

/** Decodes BTOON bytes (Uint8Array, Buffer, ArrayBuffer or DataView). Safe on untrusted input. */
function decode(data, options) {
  return native.decode(data, decodeOptions(options));
}

/** Like encode(); compression and signing run on the libuv thread pool. */
function encodeAsync(value, options) {
  try {
    return native.encodeAsync(value, encodeOptions(options));
  } catch (err) {
    return Promise.reject(err);
  }
}

/** Like decode(); parsing runs on the libuv thread pool (the input is copied first). */
function decodeAsync(data, options) {
  try {
    return native.decodeAsync(data, decodeOptions(options));
  } catch (err) {
    return Promise.reject(err);
  }
}

/** True if this build supports the compression algorithm ('zlib' always is). */
function compressionAvailable(algorithm) {
  return ALGORITHMS.has(algorithm) && native.compressionAvailable(algorithm);
}

module.exports = {
  encode,
  decode,
  encodeAsync,
  decodeAsync,
  compressionAvailable,
  BtoonError,
  Ext,
  Timestamp,
  VERSION,
  SPEC_VERSION,
  /** @deprecated use VERSION */
  version: () => VERSION,
};
