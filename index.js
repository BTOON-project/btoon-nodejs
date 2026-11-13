'use strict';
/**
 * btoon — BTOON for Node.js (native, via Node-API).
 * The API matches @btoon/js, the pure JavaScript implementation.
 */

// Loads the prebuilt binary for this platform (prebuilds/) or a local build (build/).
const native = require('node-gyp-build')(__dirname);

const VERSION = '0.1.2';
const SPEC_VERSION = native.specVersion;

/** Error thrown for invalid BTOON data or values that can't be encoded. `code` is a spec error code. */
class BtoonError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BtoonError';
    this.code = code;
  }
}

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;
/** Date's range is ±8.64e15 ms around the epoch. */
const MAX_DATE_MS = 8_640_000_000_000_000n;

/**
 * An extension value BTOON doesn't interpret: `type` in -128..127 plus raw bytes.
 * Throws BtoonError `invalid_argument` for a type out of range (encode checks it again).
 */
class Ext {
  constructor(type, data) {
    if (typeof type !== 'number' || !Number.isInteger(type) || type < -128 || type > 127) {
      throw new BtoonError('invalid_argument', `Ext type must be an integer in [-128, 127], got ${String(type)}`);
    }
    this.type = type;
    this.data = data instanceof Uint8Array ? data : new Uint8Array(data);
  }
}

/**
 * A timestamp with nanosecond precision and an optional UTC offset (minutes).
 * Throws BtoonError `invalid_argument` for a field out of range: seconds must fit in int64.
 * encode() checks the fields again, so values assigned later can't wrap either.
 */
class Timestamp {
  constructor(seconds, nanoseconds = 0, offsetMinutes = undefined) {
    let s;
    try {
      s = typeof seconds === 'bigint' ? seconds : BigInt(seconds);
    } catch {
      throw new BtoonError('invalid_argument', 'Timestamp seconds must be a bigint or an integer');
    }
    if (s < INT64_MIN || s > INT64_MAX) {
      throw new BtoonError('invalid_argument', 'Timestamp seconds must fit in a signed 64-bit integer');
    }
    if (typeof nanoseconds !== 'number' || !Number.isInteger(nanoseconds) || nanoseconds < 0 || nanoseconds >= 1e9) {
      throw new BtoonError('invalid_argument', 'Timestamp nanoseconds must be an integer in [0, 999999999]');
    }
    if (
      offsetMinutes !== undefined &&
      (typeof offsetMinutes !== 'number' || !Number.isInteger(offsetMinutes) || offsetMinutes < -1080 || offsetMinutes > 1080)
    ) {
      throw new BtoonError('invalid_argument', 'Timestamp offsetMinutes must be an integer in [-1080, 1080]');
    }
    this.seconds = s;
    this.nanoseconds = nanoseconds;
    this.offsetMinutes = offsetMinutes;
  }

  /**
   * Millisecond-precision Date for this instant (sub-millisecond digits are truncated toward
   * the past). Throws BtoonError `invalid_argument` outside the range of Date.
   */
  toDate() {
    const ms = BigInt(this.seconds) * 1000n + BigInt(Math.floor(this.nanoseconds / 1e6));
    if (ms > MAX_DATE_MS || ms < -MAX_DATE_MS) {
      throw new BtoonError('invalid_argument', 'Timestamp is outside the range of Date');
    }
    return new Date(Number(ms));
  }

  static fromDate(date) {
    const ms = date.getTime();
    if (!Number.isFinite(ms)) throw new BtoonError('invalid_argument', 'cannot convert an invalid Date');
    const seconds = Math.floor(ms / 1000);
    return new Timestamp(seconds, (ms - seconds * 1000) * 1e6);
  }
}

/**
 * Classifies an object whose prototype Node-API reports as null: an Object.create(null)
 * object or a Proxy (Vue and MobX reactive state). napi_get_prototype never runs a Proxy's
 * getPrototypeOf trap and reports null for every Proxy, while Array.isArray and
 * Object.getPrototypeOf see through it, as in @btoon/js. Plain objects and arrays never get
 * here. Returns the native `Kind`: 0 plain object, 1 array, 2 other object, 3 Date.
 */
function proxyKind(o) {
  if (Array.isArray(o)) return 1;
  const proto = Object.getPrototypeOf(o);
  if (proto === null || proto === Object.prototype) return 0;
  return o instanceof Date ? 3 : 2;
}

native.setup({
  BtoonError,
  Ext,
  Timestamp,
  Map,
  arrayFrom: Array.from,
  objectPrototype: Object.prototype,
  proxyKind,
  // The intrinsic getter, for typed array types the native side doesn't know (Float16Array).
  typedArrayByteLength: Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'byteLength').get,
});

const ALGORITHMS = new Set(['zlib', 'lz4', 'zstd', 'brotli', 'snappy', 'auto']);

// String.prototype.isWellFormed is Node 20+; the pattern (from @btoon/js) covers Node 18.
const LONE_SURROGATE = /(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;
const isWellFormed =
  typeof String.prototype.isWellFormed === 'function' ? (s) => s.isWellFormed() : (s) => !LONE_SURROGATE.test(s);

function keyBytes(key) {
  if (key === undefined || key === null) return undefined;
  let bytes;
  if (typeof key === 'string') {
    // UTF-8 has no form for a lone surrogate. Buffer.from would write U+FFFD instead, so
    // 'k\ud800' and 'k\udfff' would be the same key. Reject it, as @btoon/js does.
    if (!isWellFormed(key)) throw new BtoonError('invalid_argument', 'hmacKey string contains a lone surrogate');
    bytes = Buffer.from(key, 'utf8');
  } else if (key instanceof Uint8Array) bytes = key;
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
