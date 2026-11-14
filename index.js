'use strict';
/**
 * btoon — BTOON for Node.js (native, via Node-API).
 * The API and behavior match @btoon/js, the pure JavaScript implementation, which is the
 * reference: the classes, the option checks and the encoder's classification of values below
 * are ports of its values.ts, options.ts and encode.ts. Keep them in step.
 */

// Loads the prebuilt binary for this platform (prebuilds/) or a local build (build/).
const native = require('node-gyp-build')(__dirname);

const VERSION = '0.3.0';
const SPEC_VERSION = native.specVersion;

// Core's limits (spec §7 and §7.1).
const DEFAULT_MAX_DEPTH = native.defaultMaxDepth; // 128
const MAX_DEPTH_LIMIT = native.maxDepthLimit; // 1000
const DEFAULT_MAX_DECOMPRESSED_SIZE = native.defaultMaxDecompressedSize; // 64 MiB
const DEFAULT_MAX_VALUES = native.defaultMaxValues; // 2 ** 20

// Brands shared with @btoon/js: `instanceof` and the encoder recognize instances from either
// package, any copy of them and any realm.
const EXT_BRAND = Symbol.for('btoon.Ext');
const TIMESTAMP_BRAND = Symbol.for('btoon.Timestamp');
const DATE_BRAND = Symbol.for('btoon.Date');
const DATETIME_BRAND = Symbol.for('btoon.DateTime');
const ERROR_BRAND = Symbol.for('btoon.BtoonError');

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;
/** Date's range is ±8.64e15 ms around the epoch. */
const MAX_DATE_MS = 8_640_000_000_000_000n;
const ordinaryHasInstance = Function.prototype[Symbol.hasInstance];
const objectToString = Object.prototype.toString;
const hasOwn = Object.prototype.hasOwnProperty;

const branded = (v, brand) => typeof v === 'object' && v !== null && v[brand] === true;

// The intrinsic accessors: they work on objects of any realm, and a subclass can't override them.
const getter = (proto, name) => Object.getOwnPropertyDescriptor(proto, name).get;
const TypedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayTag = getter(TypedArrayPrototype, Symbol.toStringTag);
const VIEW = {
  typed: [getter(TypedArrayPrototype, 'buffer'), getter(TypedArrayPrototype, 'byteOffset'), getter(TypedArrayPrototype, 'byteLength')],
  dataView: [getter(DataView.prototype, 'buffer'), getter(DataView.prototype, 'byteOffset'), getter(DataView.prototype, 'byteLength')],
};
const arrayBufferLength = getter(ArrayBuffer.prototype, 'byteLength');
const sharedArrayBufferLength = typeof SharedArrayBuffer === 'function' ? getter(SharedArrayBuffer.prototype, 'byteLength') : undefined;
const mapSize = getter(Map.prototype, 'size');
const mapKeysOf = Map.prototype.keys;
const mapGet = Map.prototype.get;

/** True for a Uint8Array of any realm (a Buffer is one). */
const isUint8Array = (v) => typedArrayTag.call(v) === 'Uint8Array';

/** True if `v` is an ArrayBuffer (`shared` false) or a SharedArrayBuffer (`shared` true) of any realm. */
function isBuffer(v, shared) {
  const length = shared ? sharedArrayBufferLength : arrayBufferLength;
  if (length === undefined) return false;
  try {
    length.call(v);
    return true;
  } catch {
    return false;
  }
}

/** Error thrown for invalid BTOON data or values that can't be encoded. `code` is a spec error code. */
class BtoonError extends Error {
  constructor(code, message, options) {
    super(message);
    this.name = 'BtoonError';
    this.code = code;
    if (options !== undefined && options !== null && 'cause' in options) {
      Object.defineProperty(this, 'cause', { value: options.cause, writable: true, enumerable: false, configurable: true });
    }
  }

  static [Symbol.hasInstance](value) {
    return this === BtoonError ? branded(value, ERROR_BRAND) : ordinaryHasInstance.call(this, value);
  }
}
Object.defineProperty(BtoonError.prototype, ERROR_BRAND, { value: true });

const fail = (code, message) => new BtoonError(code, message);

/** A bigint, or a safe-integer number, in the int64 range; `invalid_argument` otherwise. */
function int64(v, what) {
  let n;
  if (typeof v === 'bigint') n = v;
  else if (typeof v === 'number' && Number.isSafeInteger(v)) n = BigInt(v);
  else throw fail('invalid_argument', `${what} must be a bigint or a safe integer`);
  if (n < INT64_MIN || n > INT64_MAX) throw fail('invalid_argument', `${what} must fit in a signed 64-bit integer`);
  return n;
}

/** `[q, r]` with `a = q·b + r` and `0 ≤ r < b`: division rounded toward −∞. */
function floorDiv(a, b) {
  let q = a / b;
  let r = a % b;
  if (r < 0n) {
    r += b;
    q -= 1n;
  }
  return [q, r];
}

/** Milliseconds of a Date (from any realm); throws for an invalid Date. */
function dateTime(date, invalid) {
  let ms;
  try {
    ms = Date.prototype.getTime.call(date);
  } catch {
    throw fail('invalid_argument', 'expected a Date');
  }
  if (!Number.isFinite(ms)) throw fail('invalid_argument', invalid);
  return ms;
}

/**
 * An extension value BTOON doesn't interpret: `type` in -128..127 and a Uint8Array payload.
 * The ids BTOON defines (-1…-6, -10) construct, but encoding one throws `invalid_argument`
 * (spec §5.7): those types are written from their typed values.
 */
class Ext {
  constructor(type, data) {
    if (typeof type !== 'number' || !Number.isInteger(type) || type < -128 || type > 127) {
      throw fail('invalid_argument', `Ext type must be an integer in [-128, 127], got ${String(type)}`);
    }
    if (!isUint8Array(data)) throw fail('invalid_argument', 'Ext data must be a Uint8Array');
    this.type = type;
    this.data = data;
  }

  static [Symbol.hasInstance](value) {
    return this === Ext ? branded(value, EXT_BRAND) : ordinaryHasInstance.call(this, value);
  }
}
Object.defineProperty(Ext.prototype, EXT_BRAND, { value: true });

/**
 * A timestamp (extension -1) with nanosecond precision and an optional UTC offset (minutes).
 * Throws BtoonError `invalid_argument` for a field out of range. encode() checks the fields
 * again, so values assigned later can't wrap either.
 */
class Timestamp {
  constructor(seconds, nanoseconds = 0, offsetMinutes = undefined) {
    const s = int64(seconds, 'Timestamp seconds');
    if (typeof nanoseconds !== 'number' || !Number.isInteger(nanoseconds) || nanoseconds < 0 || nanoseconds >= 1e9) {
      throw fail('invalid_argument', 'Timestamp nanoseconds must be an integer in [0, 999999999]');
    }
    if (
      offsetMinutes !== undefined &&
      (typeof offsetMinutes !== 'number' || !Number.isInteger(offsetMinutes) || offsetMinutes < -1080 || offsetMinutes > 1080)
    ) {
      throw fail('invalid_argument', 'Timestamp offsetMinutes must be an integer in [-1080, 1080]');
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
    const ms = this.seconds * 1000n + BigInt(Math.floor(this.nanoseconds / 1e6));
    if (ms > MAX_DATE_MS || ms < -MAX_DATE_MS) throw fail('invalid_argument', 'Timestamp is outside the range of Date');
    return new Date(Number(ms));
  }

  static fromDate(date) {
    const ms = dateTime(date, 'cannot convert an invalid Date');
    const seconds = Math.floor(ms / 1000);
    return new Timestamp(BigInt(seconds), (ms - seconds * 1000) * 1e6);
  }

  static [Symbol.hasInstance](value) {
    return this === Timestamp ? branded(value, TIMESTAMP_BRAND) : ordinaryHasInstance.call(this, value);
  }
}
Object.defineProperty(Timestamp.prototype, TIMESTAMP_BRAND, { value: true });

/** The UTC instant of a Timestamp, for a date or datetime, which have no offset. */
function utcInstant(ts, target) {
  if (!branded(ts, TIMESTAMP_BRAND)) throw fail('invalid_argument', `${target}.fromTimestamp() expects a Timestamp`);
  const { seconds, nanoseconds, offsetMinutes } = ts;
  if (typeof seconds !== 'bigint' || seconds < INT64_MIN || seconds > INT64_MAX) {
    throw fail('invalid_argument', 'Timestamp seconds must be a bigint in the int64 range');
  }
  if (typeof nanoseconds !== 'number' || !Number.isInteger(nanoseconds) || nanoseconds < 0 || nanoseconds >= 1e9) {
    throw fail('invalid_argument', 'Timestamp nanoseconds must be an integer in [0, 999999999]');
  }
  if (offsetMinutes !== undefined) {
    throw fail('invalid_argument', `a Timestamp with a UTC offset can't be a ${target}, which has none`);
  }
  return { seconds, nanoseconds };
}

/** A date (extension -2): milliseconds since the Unix epoch, UTC, with no offset. */
class BtoonDate extends Timestamp {
  constructor(epochMilliseconds) {
    const ms = int64(epochMilliseconds, 'BtoonDate epochMilliseconds');
    const [seconds, millis] = floorDiv(ms, 1000n);
    super(seconds, Number(millis) * 1_000_000);
    this.epochMilliseconds = ms;
  }

  static fromDate(date) {
    return new BtoonDate(dateTime(date, 'cannot convert an invalid Date'));
  }

  /** Floors to the millisecond. */
  static fromTimestamp(ts) {
    const { seconds, nanoseconds } = utcInstant(ts, 'BtoonDate');
    const ms = seconds * 1000n + BigInt(Math.floor(nanoseconds / 1e6));
    if (ms < INT64_MIN || ms > INT64_MAX) throw fail('invalid_argument', 'Timestamp is outside the range of BtoonDate');
    return new BtoonDate(ms);
  }

  static [Symbol.hasInstance](value) {
    return this === BtoonDate ? branded(value, DATE_BRAND) : ordinaryHasInstance.call(this, value);
  }
}
Object.defineProperty(BtoonDate.prototype, DATE_BRAND, { value: true });

/** A datetime (extension -3): nanoseconds since the Unix epoch, UTC, with no offset. */
class BtoonDateTime extends Timestamp {
  constructor(epochNanoseconds) {
    const ns = int64(epochNanoseconds, 'BtoonDateTime epochNanoseconds');
    const [seconds, nanos] = floorDiv(ns, 1_000_000_000n);
    super(seconds, Number(nanos));
    this.epochNanoseconds = ns;
  }

  static fromDate(date) {
    const ns = BigInt(dateTime(date, 'cannot convert an invalid Date')) * 1_000_000n;
    if (ns < INT64_MIN || ns > INT64_MAX) throw fail('invalid_argument', 'Date is outside the range of BtoonDateTime');
    return new BtoonDateTime(ns);
  }

  /** Exact. */
  static fromTimestamp(ts) {
    const { seconds, nanoseconds } = utcInstant(ts, 'BtoonDateTime');
    const ns = seconds * 1_000_000_000n + BigInt(nanoseconds);
    if (ns < INT64_MIN || ns > INT64_MAX) throw fail('invalid_argument', 'Timestamp is outside the range of BtoonDateTime');
    return new BtoonDateTime(ns);
  }

  static [Symbol.hasInstance](value) {
    return this === BtoonDateTime ? branded(value, DATETIME_BRAND) : ordinaryHasInstance.call(this, value);
  }
}
Object.defineProperty(BtoonDateTime.prototype, DATETIME_BRAND, { value: true });

// --- the encoder's classification (@btoon/js encode.ts) ----------------------------------------
// The addon settles arrays, plain objects, typed arrays, ArrayBuffers and Dates itself, and asks
// classify() about every other object: the kinds are the K_* numbers of encode.ts.

const K_ARRAY = 1;
const K_PLAIN = 2;
const K_VIEW = 3;
const K_BUFFER = 4;
const K_DATE = 5;
const K_MAP = 6;
const K_TIMESTAMP = 7;
const K_EXT = 8;
const K_TOJSON = 9;
const K_BOXED = 10;
const K_OBJECT = 11;
const K_BTOON_DATE = 12;
const K_BTOON_DATETIME = 13;
const K_PROXY_MAP = 14;

const NOT_BOXED = Symbol('not boxed');
const BOXES = new Map([
  ['[object Number]', Number.prototype],
  ['[object String]', String.prototype],
  ['[object Boolean]', Boolean.prototype],
  ['[object BigInt]', BigInt.prototype],
]);

/** The primitive inside a wrapper object, checked by internal slot (a spoofed tag fails). */
function unbox(o, tag = objectToString.call(o)) {
  const proto = BOXES.get(tag);
  if (proto === undefined) return NOT_BOXED;
  try {
    return proto.valueOf.call(o);
  } catch {
    return NOT_BOXED;
  }
}

/** True for a Map of any realm (it has [[MapData]]); false for a Proxy of one. */
function isMap(o) {
  try {
    mapSize.call(o);
    return true;
  } catch {
    return false;
  }
}

/** A plain object's own toJSON(), which JSON.stringify calls; an inherited one is ignored. */
const ownToJSON = (o) => typeof o.toJSON === 'function' && hasOwn.call(o, 'toJSON');

function classify(o) {
  if (Array.isArray(o)) return K_ARRAY;
  const proto = Object.getPrototypeOf(o);
  if (proto === Object.prototype || proto === null) return ownToJSON(o) ? K_TOJSON : K_PLAIN;
  if (ArrayBuffer.isView(o)) return K_VIEW;
  if (o instanceof Date) return K_DATE;
  if (o instanceof Map) return isMap(o) ? K_MAP : K_PROXY_MAP;
  if (branded(o, TIMESTAMP_BRAND)) return branded(o, DATETIME_BRAND) ? K_BTOON_DATETIME : branded(o, DATE_BRAND) ? K_BTOON_DATE : K_TIMESTAMP;
  if (branded(o, EXT_BRAND)) return K_EXT;
  const tag = objectToString.call(o);
  if (tag === '[object ArrayBuffer]' || tag === '[object SharedArrayBuffer]') return K_BUFFER;
  if (tag === '[object Date]') return K_DATE; // from another realm
  if (tag === '[object Map]' && isMap(o)) return K_MAP; // from another realm
  if (typeof o.toJSON === 'function') return K_TOJSON;
  if (unbox(o, tag) !== NOT_BOXED) return K_BOXED;
  return K_OBJECT;
}

/**
 * The keys of a Map, or null if one isn't a string. A Map's keys come from the intrinsic
 * Map.prototype.keys, so a subclass's own iterator can't repeat one. A proxied Map's (Vue's
 * and MobX's reactive Maps) come from its own keys(), which must not repeat one either.
 */
function mapKeys(m, kind) {
  const keys = [];
  for (const k of kind === K_MAP ? mapKeysOf.call(m) : m.keys()) {
    if (typeof k !== 'string') return null;
    keys.push(k);
  }
  if (kind === K_PROXY_MAP && keys.length > 1 && new Set(keys).size !== keys.length) {
    throw fail('invalid_argument', 'a Map yielded the same key twice');
  }
  return keys;
}

native.setup({
  BtoonError,
  Ext,
  Timestamp,
  BtoonDate,
  BtoonDateTime,
  objectPrototype: Object.prototype,
  classify,
  unbox: (o) => unbox(o),
  mapKeys,
  mapGet: (m, kind, key) => (kind === K_MAP ? mapGet.call(m, key) : m.get(key)),
  // A SharedArrayBuffer, which Node-API can't read as an ArrayBuffer.
  bytesOf: (buffer) => new Uint8Array(buffer),
  // The intrinsic getter, for typed array types the native side doesn't know (Float16Array).
  typedArrayByteLength: VIEW.typed[2],
});

// --- options: the same checks, defaults and messages as @btoon/js (options.ts) -----------------

const ALGORITHMS = ['zlib', 'lz4', 'zstd', 'brotli', 'snappy'];

// 'auto' (accepted by 0.2) is a deprecated alias for 'zlib': that is what it produced, since
// the builds have only zlib, and what spec §6 says encoders use when no algorithm is named.
// @btoon/js doesn't accept it. Using it warns once per process.
let warnedAuto = false;
function deprecatedAuto() {
  if (warnedAuto) return;
  warnedAuto = true;
  process.emitWarning("btoon: compression 'auto' is deprecated; it means 'zlib', so pass 'zlib' (or leave it out)", {
    type: 'DeprecationWarning',
    code: 'BTOON_DEP_AUTO',
  });
}

function compressionOption(o) {
  if (o.compression === 'auto') {
    deprecatedAuto();
    return 'zlib';
  }
  return oneOf(o, 'compression', ALGORITHMS, 'zlib');
}

// String.prototype.isWellFormed is Node 20+; the pattern (from @btoon/js) covers Node 18.
const LONE_SURROGATE = /(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;
const isWellFormed =
  typeof String.prototype.isWellFormed === 'function' ? (s) => s.isWellFormed() : (s) => !LONE_SURROGATE.test(s);

function optionsObject(options, what) {
  if (options === undefined || options === null) return {};
  if (typeof options !== 'object') throw fail('invalid_argument', `${what} options must be an object`);
  return options;
}

function bool(o, name, dflt) {
  const v = o[name];
  if (v === undefined) return dflt;
  if (typeof v !== 'boolean') throw fail('invalid_argument', `option ${name} must be a boolean`);
  return v;
}

function count(o, name, dflt) {
  const v = o[name];
  if (v === undefined) return dflt;
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) {
    throw fail('invalid_argument', `option ${name} must be a non-negative integer`);
  }
  return v;
}

// At most MAX_DEPTH_LIMIT (spec §7): a deeper limit would let input, or a deep value, exhaust
// the native stack.
function depth(o) {
  const v = count(o, 'maxDepth', DEFAULT_MAX_DEPTH);
  if (v > MAX_DEPTH_LIMIT) throw fail('invalid_argument', `option maxDepth must be at most ${MAX_DEPTH_LIMIT}, got ${v}`);
  return v;
}

function oneOf(o, name, allowed, dflt) {
  const v = o[name];
  if (v === undefined) return dflt;
  if (typeof v !== 'string' || !allowed.includes(v)) {
    throw fail('invalid_argument', `option ${name} must be one of ${allowed.map((a) => `'${a}'`).join(', ')}`);
  }
  return v;
}

// Only an absent key (undefined) means "no key" (spec §8). null and an empty key are
// configuration errors: a key read from an unset or empty source must not silently turn
// signing or verification off. The key is copied, so later changes to it don't matter.
function hmacKey(o) {
  const v = o.hmacKey;
  if (v === undefined) return undefined;
  if (v === null) throw fail('invalid_argument', 'option hmacKey is null; leave it undefined for no key');
  let key;
  if (typeof v === 'string') {
    // UTF-8 has no form for a lone surrogate (Buffer.from would write U+FFFD, merging keys).
    if (!isWellFormed(v)) throw fail('invalid_argument', 'hmacKey string contains a lone surrogate');
    key = Buffer.from(v, 'utf8');
  } else if (isUint8Array(v)) {
    key = Uint8Array.prototype.slice.call(v);
  } else {
    throw fail('invalid_argument', 'option hmacKey must be a Uint8Array or a string');
  }
  if (key.length === 0) throw fail('invalid_argument', 'option hmacKey is empty; leave it undefined for no key');
  return key;
}

// @btoon/js's caller-supplied codecs. They are checked the same way, but this package doesn't
// call them: it compresses and decompresses with the codecs built into it (zlib in the
// prebuilds; see compressionAvailable()).
function checkCodecs(o) {
  const v = o.codecs;
  if (v === undefined) return;
  if (typeof v !== 'object' || v === null) throw fail('invalid_argument', 'option codecs must be an object');
  for (const name of ALGORITHMS) {
    const c = v[name];
    if (c === undefined) continue;
    if (typeof c !== 'object' || c === null) throw fail('invalid_argument', `codecs.${name} must be an object`);
    for (const fn of ['compress', 'decompress']) {
      if (c[fn] !== undefined && typeof c[fn] !== 'function') throw fail('invalid_argument', `codecs.${name}.${fn} must be a function`);
    }
  }
}

function encodeOptions(options) {
  const o = optionsObject(options, 'encode');
  const out = {
    compress: bool(o, 'compress', false),
    compression: compressionOption(o),
    autoTabular: bool(o, 'autoTabular', true),
    maxDepth: depth(o),
    hmacKey: hmacKey(o),
  };
  checkCodecs(o);
  return out;
}

function decodeOptions(options) {
  const o = optionsObject(options, 'decode');
  const out = {
    strict: bool(o, 'strict', true),
    maxDepth: depth(o),
    maxDecompressedSize: count(o, 'maxDecompressedSize', DEFAULT_MAX_DECOMPRESSED_SIZE),
    maxValues: count(o, 'maxValues', DEFAULT_MAX_VALUES),
    autoDecompress: bool(o, 'autoDecompress', true),
    hmacKey: hmacKey(o),
    timestamps: oneOf(o, 'timestamps', ['date', 'object'], 'date'),
    bigint: oneOf(o, 'bigint', ['auto', 'always'], 'auto'),
  };
  checkCodecs(o);
  return out;
}

/**
 * decode's input: an ArrayBufferView, ArrayBuffer or SharedArrayBuffer of any realm. Shared
 * memory is copied once first: the signature must be verified on the bytes that are then
 * parsed, and another thread can change shared memory in between (review 2026-11-13: a worker
 * got forgeries through).
 */
function inputOf(data) {
  if (ArrayBuffer.isView(data)) {
    const [bufferOf, offsetOf, lengthOf] = typedArrayTag.call(data) !== undefined ? VIEW.typed : VIEW.dataView;
    const buffer = bufferOf.call(data);
    if (!isBuffer(buffer, true)) return data;
    return new Uint8Array(buffer, offsetOf.call(data), lengthOf.call(data)).slice();
  }
  if (isBuffer(data, false)) return data;
  if (isBuffer(data, true)) return new Uint8Array(data).slice();
  throw fail('invalid_argument', 'decode() expects a Uint8Array, ArrayBuffer or other ArrayBufferView');
}

/** Encodes a value to canonical BTOON. Returns a Buffer (a Uint8Array). */
function encode(value, options) {
  return native.encode(value, encodeOptions(options));
}

/** Decodes BTOON bytes (Uint8Array, Buffer, ArrayBuffer, DataView, SharedArrayBuffer). Safe on untrusted input. */
function decode(data, options) {
  const o = decodeOptions(options);
  return native.decode(inputOf(data), o);
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
    const o = decodeOptions(options);
    return native.decodeAsync(inputOf(data), o);
  } catch (err) {
    return Promise.reject(err);
  }
}

/** True if this build supports the compression algorithm ('zlib' always is). */
function compressionAvailable(algorithm) {
  if (algorithm === 'auto') {
    deprecatedAuto();
    algorithm = 'zlib';
  }
  return ALGORITHMS.includes(algorithm) && native.compressionAvailable(algorithm);
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
  BtoonDate,
  BtoonDateTime,
  VERSION,
  SPEC_VERSION,
  /** @deprecated use VERSION */
  version: () => VERSION,
};
