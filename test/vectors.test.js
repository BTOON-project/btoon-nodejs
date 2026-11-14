'use strict';
// Conformance: btoon-core/tests/vectors/btoon-vectors.json (spec §10).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const btoon = require('..');

const { Ext, Timestamp, BtoonDate, BtoonDateTime, BtoonError } = btoon;

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
    // spec §10: the typed values for the date (-2) and datetime (-3) extensions.
    case 'date': return new BtoonDate(BigInt(x));
    case 'datetime': return new BtoonDateTime(BigInt(x));
    case 'float32_vector': return floatVector(x, Float32Array);
    case 'float64_vector': return floatVector(x, Float64Array);
    case 'ext': return new Ext(x.type, Buffer.from(x.data, 'hex'));
    default: throw new Error(`unknown typed kind ${kind}`);
  }
}

// Typed values no JS value encodes to, as in @btoon/js (spec §10): only floats that are safe
// integers (a JS 2.0 is 2, an int). Other integral floats (2^53, 1e300) and -0 encode as
// float64, and dates and datetimes re-encode from BtoonDate and BtoonDateTime.
function reencodable(t) {
  const [[kind, x]] = Object.entries(t);
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
    // The exact class too: a timestamp, date and datetime are different BTOON values.
    return Object.getPrototypeOf(a) === Object.getPrototypeOf(b) && a.seconds === b.seconds && a.nanoseconds === b.nanoseconds &&
      a.offsetMinutes === b.offsetMinutes && a.epochMilliseconds === b.epochMilliseconds && a.epochNanoseconds === b.epochNanoseconds;
  }
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && same(a[k], b[k]));
  }
  return a === b;
}

// With bigint: 'auto' an integer is a number when it's a safe integer, with 'always' when it's in
// [-2^31, 2^32-1]; otherwise a bigint (as in @btoon/js). Checks every integer of a typed value.
function intTypes(got, t, always) {
  const [[kind, x]] = Object.entries(t);
  if (kind === 'int') {
    const v = BigInt(x);
    const number = always ? v >= -(2n ** 31n) && v <= 2n ** 32n - 1n : v >= -BigInt(Number.MAX_SAFE_INTEGER) && v <= BigInt(Number.MAX_SAFE_INTEGER);
    return typeof got === (number ? 'number' : 'bigint');
  }
  if (kind === 'array') return Array.isArray(got) && x.every((e, i) => intTypes(got[i], e, always));
  if (kind === 'map') return Object.entries(x).every(([k, e]) => intTypes(got[k], e, always));
  return true;
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

// The builds have zlib only, so the vectors that need another codec are skipped below (each
// with "<codec> not built"), the lz4-block/* end-of-block cases among them.
test('vectors that need a codec this build lacks are the ones skipped', () => {
  const lz4Blocks = VECTORS.vectors.filter((v) => v.id.startsWith('lz4-block/'));
  assert.ok(lz4Blocks.length >= 8);
  for (const v of lz4Blocks) assert.equal(v.requires, 'lz4', v.id);
  assert.equal(btoon.compressionAvailable('lz4'), false);
  assert.equal(btoon.compressionAvailable('zlib'), true);
});

// Canonical vectors that skip their re-encoding. The list must be exact: dates and datetimes
// re-encode from BtoonDate and BtoonDateTime, as the spec 0.3 vectors require.
const NOT_REENCODED = [];
test('only float/0 skips its re-encoding', () => {
  assert.deepStrictEqual(NOT_REENCODED, ['float/0']);
  for (const id of ['date/max', 'date/min', 'datetime/max', 'datetime/min', 'tabular/date-and-datetime-columns', 'tabular/type-code-9-variants']) {
    assert.ok(VECTORS.vectors.some((v) => v.id === id && v.canonical), id);
  }
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
    assert.ok(intTypes(btoon.decode(bytes, decodeOptions(v)), v.value, false), "bigint: 'auto'");
    assert.ok(intTypes(btoon.decode(bytes, { ...decodeOptions(v), bigint: 'always' }), v.value, true), "bigint: 'always'");
  });
  if (v.canonical) {
    if (!reencodable(v.value)) NOT_REENCODED.push(v.id);
    test(`re-encodes ${v.id}`, { skip: skip || (!reencodable(v.value) && 'not representable in JS') }, async () => {
      assert.equal(btoon.encode(fromTyped(v.value), encodeOptions(v)).toString('hex'), v.hex);
      assert.equal((await btoon.encodeAsync(fromTyped(v.value), encodeOptions(v))).toString('hex'), v.hex);
      // What the lossless mode decodes writes the same bytes back (spec §10).
      const back = btoon.decode(bytes, { ...decodeOptions(v), timestamps: 'object' });
      assert.equal(btoon.encode(back, encodeOptions(v)).toString('hex'), v.hex);
    });
  }
}
