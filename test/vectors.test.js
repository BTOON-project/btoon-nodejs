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
    case 'float32_vector': return Float32Array.from(x.map(Number));
    case 'float64_vector': return Float64Array.from(x.map(Number));
    case 'ext': return new Ext(x.type, Buffer.from(x.data, 'hex'));
    default: throw new Error(`unknown typed kind ${kind}`);
  }
}

// Typed values JS can't reproduce canonically: date/datetime (decode to Date/Timestamp,
// re-encode as timestamps) and integral floats (a JS number like 2 encodes as an int).
function reencodable(t) {
  const [[kind, x]] = Object.entries(t);
  if (kind === 'date' || kind === 'datetime') return false;
  if (kind === 'float') return !(Number.isInteger(Number(x)) && !Object.is(Number(x), -0));
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
    return b instanceof a.constructor && a.length === b.length && [...a].every((v, i) => same(v, b[i]));
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

function opts(v) {
  return v.options && v.options.hmac_key ? { hmacKey: Buffer.from(v.options.hmac_key, 'hex') } : {};
}

test('spec version', () => {
  assert.equal(VECTORS.spec, btoon.SPEC_VERSION);
});

for (const v of VECTORS.vectors) {
  const skip = v.requires && !btoon.compressionAvailable(v.requires) ? `${v.requires} not built` : false;
  if (v.error) {
    test(`rejects ${v.id}`, { skip }, () => {
      assert.throws(() => btoon.decode(Buffer.from(v.hex, 'hex'), opts(v)), (err) => {
        assert.ok(err instanceof BtoonError, `expected BtoonError, got ${err}`);
        assert.equal(err.code, v.error, err.message);
        return true;
      });
    });
    continue;
  }
  test(`decodes ${v.id}`, { skip }, () => {
    const got = btoon.decode(Buffer.from(v.hex, 'hex'), { ...opts(v), timestamps: 'object' });
    assert.ok(same(got, fromTyped(v.value)), `decoded ${String(got)}`);
  });
  if (v.canonical) {
    test(`re-encodes ${v.id}`, { skip: skip || (!reencodable(v.value) && 'not representable in JS') }, () => {
      assert.equal(btoon.encode(fromTyped(v.value), opts(v)).toString('hex'), v.hex);
    });
  }
}
