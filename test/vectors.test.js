'use strict';
// Conformance: btoon-core/tests/vectors/btoon-vectors.json (spec §10).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const btoon = require('..');

const { Ext, Timestamp, BtoonError } = btoon;

function vectorsFile() {
  const root = path.resolve(__dirname, '..');
  const candidates = [
    process.env.BTOON_VECTORS,
    path.join(root, 'core/tests/vectors/btoon-vectors.json'),
    path.join(root, '../btoon-core/tests/vectors/btoon-vectors.json'),
  ];
  const found = candidates.find((c) => c && fs.existsSync(c));
  if (!found) throw new Error('btoon-vectors.json not found (git submodule update --init, or set BTOON_VECTORS)');
  return found;
}

const VECTORS = JSON.parse(fs.readFileSync(vectorsFile(), 'utf8'));

function int(s) {
  const b = BigInt(s);
  return b >= BigInt(Number.MIN_SAFE_INTEGER) && b <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(b) : b;
}

// Float vector elements (spec §10): "NaN" is the canonical quiet NaN of the width and "0x…" an
// exact bit pattern (vectors keep NaN payloads, §5.5); anything else is a decimal. The bits
// go in through an integer view of the same buffer, so nothing can canonicalize a NaN.
function floatVector(elements, Type) {
  const f32 = Type === Float32Array;
  const out = new Type(elements.length);
  const bits = f32 ? new Uint32Array(out.buffer) : new BigUint64Array(out.buffer);
  elements.forEach((e, i) => {
    if (e.startsWith('0x')) bits[i] = f32 ? Number.parseInt(e, 16) : BigInt(e);
    else if (e === 'NaN') bits[i] = f32 ? 0x7fc00000 : 0x7ff8000000000000n;
    else out[i] = Number(e); // a Float32Array rounds like a C cast: ±Infinity beyond binary32
  });
  return out;
}

function fromTyped(t) {
  const [[kind, x]] = Object.entries(t);
  switch (kind) {
    case 'nil': return null;
    case 'bool': return x;
    case 'int': return int(x);
    case 'float': return Number(x);
    case 'string': return x;
    case 'binary': return Buffer.from(x, 'hex');
    case 'array': return x.map(fromTyped);
    case 'map': return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, fromTyped(v)]));
    case 'timestamp': return new Timestamp(BigInt(x.seconds), x.nanoseconds, x.offset_minutes);
    case 'date': {
      const ms = BigInt(x);
      const s = ms >= 0n ? ms / 1000n : (ms - 999n) / 1000n;
      return new Timestamp(s, Number(ms - s * 1000n) * 1e6);
    }
    case 'datetime': {
      const ns = BigInt(x);
      const s = ns >= 0n ? ns / 1000000000n : (ns - 999999999n) / 1000000000n;
      return new Timestamp(s, Number(ns - s * 1000000000n));
    }
    case 'float32_vector': return floatVector(x, Float32Array);
    case 'float64_vector': return floatVector(x, Float64Array);
    case 'ext': return new Ext(x.type, Buffer.from(x.data, 'hex'));
    default: throw new Error(`unknown typed kind ${kind}`);
  }
}

// Typed values no JS value encodes to, as in @btoon/js: date/datetime (JS has no such types;
// they decode to Date/Timestamp and re-encode as timestamps, and spec §5.7 forbids writing
// their ids as a raw Ext), and floats that are safe integers (a JS 2.0 is 2, an int). Other
// integral floats (2^53, 1e300) and -0 encode as float64.
function reencodable(t) {
  const [[kind, x]] = Object.entries(t);
  if (kind === 'date' || kind === 'datetime') return false;
  if (kind === 'float') return !Number.isSafeInteger(Number(x)) || Object.is(Number(x), -0);
  if (kind === 'array') return x.every(reencodable);
  if (kind === 'map') return Object.values(x).every(reencodable);
  return true;
}

function same(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b) || (Number.isNaN(a) && Number.isNaN(b));
  if ((typeof a === 'bigint' || typeof a === 'number') && (typeof b === 'bigint' || typeof b === 'number')) {
    return Number.isInteger(Number(a)) && BigInt(a) === BigInt(b);
  }
  if (a instanceof Float32Array || a instanceof Float64Array) {
    // Vectors are opaque buffers: elements compare bit for bit, NaN payloads included.
    const bytes = (v) => Buffer.from(v.buffer, v.byteOffset, v.byteLength);
    return b instanceof a.constructor && bytes(a).equals(bytes(b));
  }
  if (a instanceof Uint8Array && b instanceof Uint8Array) return Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
  if (a instanceof Ext && b instanceof Ext) return a.type === b.type && same(a.data, b.data);
  if (a instanceof Timestamp && b instanceof Timestamp) {
    return a.seconds === b.seconds && a.nanoseconds === b.nanoseconds && a.offsetMinutes === b.offsetMinutes;
  }
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && same(a[k], b[k]));
  }
  return a === b;
}

// The decoder options a vector sets (spec §10). The rest keep the file's defaults.
const DECODE_OPTIONS = { strict: 'strict', max_depth: 'maxDepth', max_decompressed_size: 'maxDecompressedSize', max_values: 'maxValues' };

function decodeOptions(v) {
  const out = {};
  for (const [name, value] of Object.entries(v.options ?? {})) {
    if (name === 'hmac_key') out.hmacKey = Buffer.from(value, 'hex'); // '' is an empty key: invalid_argument
    else if (Object.hasOwn(DECODE_OPTIONS, name)) out[DECODE_OPTIONS[name]] = value;
    else throw new Error(`vector option this harness doesn't know: ${name}`);
  }
  return out;
}

// Re-encoding a signed vector signs with its key.
function encodeOptions(v) {
  return v.options?.hmac_key !== undefined ? { hmacKey: Buffer.from(v.options.hmac_key, 'hex') } : {};
}

// The error a vector expects, from the sync and the async API alike.
const failsWith = (code) => (err) => {
  assert.ok(err instanceof BtoonError, `expected BtoonError, got ${err}`);
  assert.equal(err.code, code, err.message);
  return true;
};

test('spec version', () => {
  assert.equal(VECTORS.spec, btoon.SPEC_VERSION);
});

// Vectors without options use the file's defaults (spec §10, §7.1): they must be this library's.
test('the decode defaults are the vector file\'s', () => {
  const d = VECTORS.defaults;
  assert.equal(d.strict, true);
  assert.throws(() => btoon.decode(Buffer.from('a1ff', 'hex')), failsWith('invalid_utf8'));
  const nested = (n) => Buffer.concat([Buffer.alloc(n, 0x91), Buffer.from([0xc0])]);
  btoon.decode(nested(d.max_depth));
  assert.throws(() => btoon.decode(nested(d.max_depth + 1)), failsWith('max_depth'));
  const nils = (n) => {
    const b = Buffer.alloc(5 + n, 0xc0); // array32 of n nils: n + 1 values
    b[0] = 0xdd;
    b.writeUInt32BE(n, 1);
    return b;
  };
  assert.equal(btoon.decode(nils(d.max_values - 1)).length, d.max_values - 1);
  assert.throws(() => btoon.decode(nils(d.max_values)), failsWith('size_limit'));
  const envelope = (declared) => {
    const b = Buffer.from('42544f4e01000000000000040000000078da0300', 'hex'); // the payload isn't valid
    b.writeUInt32BE(declared, 12);
    return b;
  };
  assert.throws(() => btoon.decode(envelope(d.max_decompressed_size + 1)), failsWith('size_limit'));
  assert.throws(() => btoon.decode(envelope(d.max_decompressed_size)), failsWith('invalid_envelope')); // within the limit
});

for (const v of VECTORS.vectors) {
  const skip = v.requires && !btoon.compressionAvailable(v.requires) ? `${v.requires} not built` : false;
  if (v.encode_error !== undefined) {
    // A value encoders must refuse (building it must succeed).
    test(`refuses to encode ${v.id}`, { skip }, async () => {
      assert.throws(() => btoon.encode(fromTyped(v.value), encodeOptions(v)), failsWith(v.encode_error));
      await assert.rejects(btoon.encodeAsync(fromTyped(v.value), encodeOptions(v)), failsWith(v.encode_error));
    });
    continue;
  }
  const bytes = Buffer.from(v.hex, 'hex');
  if (v.error !== undefined) {
    test(`rejects ${v.id}`, { skip }, async () => {
      assert.throws(() => btoon.decode(bytes, decodeOptions(v)), failsWith(v.error));
      await assert.rejects(btoon.decodeAsync(bytes, decodeOptions(v)), failsWith(v.error));
    });
    continue;
  }
  test(`decodes ${v.id}`, { skip }, async () => {
    const options = { ...decodeOptions(v), timestamps: 'object' };
    const got = btoon.decode(bytes, options);
    assert.ok(same(got, fromTyped(v.value)), `decoded ${String(got)}`);
    const gotAsync = await btoon.decodeAsync(bytes, options);
    assert.ok(same(gotAsync, fromTyped(v.value)), `decodeAsync gave ${String(gotAsync)}`);
  });
  if (v.canonical) {
    test(`re-encodes ${v.id}`, { skip: skip || (!reencodable(v.value) && 'not representable in JS') }, async () => {
      assert.equal(btoon.encode(fromTyped(v.value), encodeOptions(v)).toString('hex'), v.hex);
      assert.equal((await btoon.encodeAsync(fromTyped(v.value), encodeOptions(v))).toString('hex'), v.hex);
    });
  }
}
