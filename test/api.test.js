'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const btoon = require('..');

const { encode, decode, encodeAsync, decodeAsync, BtoonError, Ext, Timestamp } = btoon;
const rt = (v, o) => decode(encode(v), o);
const code = (fn) => {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof BtoonError, `expected BtoonError, got ${e && e.name}: ${e && e.message}`);
    return e.code;
  }
  assert.fail('expected an error');
};

test('basic values round-trip', () => {
  for (const v of [null, true, false, 0, 1, -1, 127, 128, -33, 2 ** 31, Number.MAX_SAFE_INTEGER, 1.5, -2.25,
    'héllo 🎉', '', [], {}, [1, [2, [3]]], { a: { b: [null] } }]) {
    assert.deepStrictEqual(rt(v), v);
  }
  assert.equal(rt(undefined), null);
  assert.deepStrictEqual(rt({ a: undefined }), { a: null });
});

test('numbers: -0 and non-finite values are floats', () => {
  assert.ok(Object.is(rt(-0), -0));
  assert.equal(encode(-0).toString('hex'), 'cb8000000000000000');
  assert.ok(Number.isNaN(rt(NaN)));
  assert.equal(rt(Infinity), Infinity);
  assert.equal(encode(2 ** 53).toString('hex').slice(0, 2), 'cb'); // beyond safe integers: float64
  assert.equal(encode(3).toString('hex'), '03');
});

test('bigint', () => {
  assert.equal(rt(2n ** 63n), 2n ** 63n);
  assert.equal(rt(2n ** 64n - 1n), 2n ** 64n - 1n);
  assert.equal(rt(-(2n ** 63n)), -(2n ** 63n));
  for (const big of [2n ** 64n, -(2n ** 63n) - 1n, 10n ** 40n, -(10n ** 40n)]) {
    const e = encode(big);
    assert.equal(e[0], 0xc7);
    assert.equal(e[2], 0xfc);
    assert.equal(decode(e), big);
  }
  assert.equal(encode(5n).toString('hex'), '05'); // canonical: small bigints are plain ints
  assert.equal(typeof decode(encode(5)), 'number');
  assert.equal(decode(encode(5), { bigint: 'always' }), 5n);
  assert.equal(decode(encode(2 ** 53 + 2)), 2 ** 53 + 2); // float64 stays a number
});

test('binary and typed arrays', () => {
  const bytes = Uint8Array.from([0, 1, 255]);
  const out = rt(bytes);
  assert.ok(Buffer.isBuffer(out));
  assert.deepStrictEqual([...out], [0, 1, 255]);
  assert.deepStrictEqual([...rt(new Uint16Array([1, 2]).buffer)], [1, 0, 2, 0]);
  assert.deepStrictEqual([...rt(new DataView(new ArrayBuffer(2)))], [0, 0]);
  const f32 = new Float32Array([1.5, -2]);
  assert.equal(encode(f32).toString('hex'), 'd7fb0000c03f000000c0');
  assert.deepStrictEqual(rt(f32), f32);
  assert.deepStrictEqual(rt(new Float64Array([0.1, 2.5])), new Float64Array([0.1, 2.5]));
  // unaligned typed-array views are copied correctly
  const buf = new ArrayBuffer(13);
  const view = new Float32Array(buf, 4, 2);
  view.set([3, 4]);
  assert.deepStrictEqual([...rt(view)], [3, 4]);
  assert.deepStrictEqual([...rt(Buffer.from('hello'))], [...Buffer.from('hello')]);
});

// node-addon-api's TypedArray::ByteLength() didn't know Float16Array: it encoded as an empty
// binary on Node 24+ and as half its bytes on Node 22 --js-float16array.
test('every view encodes exactly its bytes, Float16Array included', () => {
  const hex = (v) => Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('hex');
  for (const v of [new Int16Array([1, -1]), new Uint8ClampedArray([1, 2, 300]), new BigInt64Array([-1n]),
    new Uint32Array(new ArrayBuffer(16), 4, 2).fill(7)]) {
    assert.equal(encode(v).toString('hex'), 'c4' + v.byteLength.toString(16).padStart(2, '0') + hex(v), v.constructor.name);
  }
  if (typeof Float16Array !== 'function') return; // Node 24+, or Node 22 with --js-float16array
  const f16 = new Float16Array([1.5, -2, 65504, 0.25]);
  assert.equal(encode(f16).toString('hex'), 'c408' + hex(f16));
  const view = new Float16Array(new ArrayBuffer(16), 4, 3);
  view.set([1, 2, 3]);
  assert.equal(encode(view).toString('hex'), 'c406' + hex(view));
  assert.deepStrictEqual(decode(encode({ v: view })), { v: Buffer.from(hex(view), 'hex') });
  // Decode input and Ext data given as a Float16Array view.
  const doc = new Uint8Array(4);
  doc.set(encode({ a: 1 }));
  assert.deepStrictEqual(decode(new Float16Array(doc.buffer)), { a: 1 });
  const ext = new Ext(5, []);
  ext.data = new Float16Array([1.5]);
  assert.equal(encode(ext).toString('hex'), 'd505003e');
});

// A failed Node-API call (a getter, toJSON or Proxy trap that throws) used to leave an
// uninitialized napi_value behind, which crashed the process (linux-arm64 prebuilds, or
// builds with -ftrivial-auto-var-init=pattern). The JS error must come through unchanged.
test('a throwing getter, toJSON or Proxy trap fails encode with that error', async () => {
  const err = new Error('boom');
  const thrower = () => {
    throw err;
  };
  const withGetter = (o = {}) => Object.defineProperty(o, 'k', { enumerable: true, get: thrower });
  class Row {
    constructor() {
      withGetter(this);
    }
  }
  class Throwing extends Map {
    [Symbol.iterator]() {
      throw err;
    }
  }
  const cases = [
    withGetter(),
    withGetter({ a: 1, b: 'x' }),
    { wrap: [withGetter(), 1], z: { a: 1 } },
    [withGetter({ a: 1 }), withGetter({ a: 2 })], // rows of a would-be table
    [{ a: 1, k: 1 }, withGetter({ a: 2 })],
    new Row(),
    [new Row(), new Row()],
    { toJSON: thrower },
    new Throwing([['a', 1]]),
    new Proxy({ a: 1 }, { get: thrower }),
    new Proxy({ a: 1 }, { ownKeys: thrower }),
    new Proxy({ a: 1 }, { getOwnPropertyDescriptor: thrower }),
  ];
  for (let round = 0; round < 3; round++) {
    for (const [i, v] of cases.entries()) {
      assert.throws(() => encode(v), (e) => e === err, `case ${i}`);
      await assert.rejects(encodeAsync(v), (e) => e === err, `case ${i} (async)`);
    }
  }
  assert.deepStrictEqual(rt({ ok: true }), { ok: true }); // still usable
});

// Terminating a worker while its encodeAsync/decodeAsync was on the thread pool used to abort
// the whole process: a Napi::Error from the completion callback ended in std::terminate.
test('terminating a worker during encodeAsync and decodeAsync leaves the process running', async () => {
  const { Worker } = require('node:worker_threads');
  const code = `
    const { parentPort, workerData } = require('node:worker_threads');
    const btoon = require(workerData.lib);
    const big = { blob: Buffer.alloc(16 << 20, 7) };
    const payload = btoon.encode(big, { compress: true });
    for (let i = 0; i < 4; i++) {
      btoon.decodeAsync(payload).catch(() => {});
      btoon.encodeAsync(big, { compress: true }).catch(() => {});
    }
    parentPort.postMessage('started');`;
  for (let round = 0; round < 12; round++) {
    const w = new Worker(code, { eval: true, workerData: { lib: require.resolve('..') } });
    await new Promise((resolve, reject) => {
      w.once('message', resolve);
      w.once('error', reject);
    });
    await new Promise((resolve) => setTimeout(resolve, round % 4));
    await w.terminate();
  }
  assert.deepStrictEqual(await decodeAsync(encode({ alive: true })), { alive: true });
});

test('dates and timestamps', () => {
  const d = new Date('2024-01-01T12:30:15.123Z');
  assert.equal(rt(d).getTime(), d.getTime());
  const ts = new Timestamp(1704067200n, 123456789, -330);
  const back = decode(encode(ts), { timestamps: 'object' });
  assert.deepStrictEqual([back.seconds, back.nanoseconds, back.offsetMinutes], [1704067200n, 123456789, -330]);
  assert.equal(decode(encode(ts)).getTime(), 1704067200123);
  assert.equal(code(() => encode(new Date(NaN))), 'invalid_argument');
  assert.equal(Timestamp.fromDate(new Date(-1)).nanoseconds, 999000000);
});

test('Map, class instances and toJSON', () => {
  assert.deepStrictEqual(rt(new Map([['b', 1], ['a', 2]])), { a: 2, b: 1 });
  assert.equal(code(() => encode(new Map([[1, 'x']]))), 'invalid_argument');
  class Point {
    constructor() { this.x = 1; this.y = 2; }
    get norm() { return 3; } // prototype getter: not own, not encoded
  }
  assert.deepStrictEqual(rt(new Point()), { x: 1, y: 2 });
  assert.deepStrictEqual(rt({ when: { toJSON: () => 'today' } }), { when: 'today' });
  assert.equal(code(() => encode({ f() {} })), 'invalid_argument');
  assert.equal(code(() => encode(Symbol('s'))), 'invalid_argument');
});

test('keys are sorted by UTF-8 bytes, including astral characters', () => {
  // JS sort() would put U+FF61 (3 UTF-8 bytes) after 𝒜 (U+1D49C, 4 bytes, surrogate pair 0xD835…).
  const obj = { '\u{1D49C}': 1, '｡': 2, b: 3 };
  const hex = encode(obj).toString('hex');
  assert.ok(hex.indexOf('62') < hex.indexOf('efbda1'));
  assert.ok(hex.indexOf('efbda1') < hex.indexOf('f09d929c'));
});

test('lone surrogates are invalid_utf8, like @btoon/js', () => {
  const code = (fn) => { try { fn(); } catch (e) { return e.code; } return 'no error'; };
  assert.equal(code(() => btoon.encode('a\ud800b')), 'invalid_utf8');
  assert.equal(code(() => btoon.encode(['ok', '\udc00'])), 'invalid_utf8');
  assert.equal(code(() => btoon.encode({ ['k\ud83d']: 1 })), 'invalid_utf8');
  assert.equal(code(() => btoon.encode('x'.repeat(5000) + '\ud800')), 'invalid_utf8');
  // Real U+FFFD and well-formed pairs are fine.
  for (const s of ['\ufffd', 'a\ud83d\ude00b', '\ud83d\ude00\ufffd', '\ufffd'.repeat(3000)]) {
    assert.equal(btoon.decode(btoon.encode(s)), s);
  }
  if (typeof String.prototype.toWellFormed === 'function') {
    assert.equal(btoon.decode(btoon.encode('a\ud800b'.toWellFormed())), 'a\ufffdb');
  }
});

test('__proto__ keys stay own properties', () => {
  const bytes = Buffer.from('81a95f5f70726f746f5f5f81a178c3', 'hex'); // {"__proto__": {"x": true}}
  const out = decode(bytes);
  assert.equal(Object.getPrototypeOf(out), Object.prototype);
  assert.deepStrictEqual(Object.keys(out), ['__proto__']);
  assert.equal(out.x, undefined);
  assert.deepStrictEqual(Object.getOwnPropertyDescriptor(out, '__proto__').value, { x: true });
  assert.equal({}.x, undefined); // nothing leaked onto Object.prototype
});

test('cycles and depth limits', () => {
  const a = [];
  a.push(a);
  assert.equal(code(() => encode(a)), 'max_depth');
  const o = {};
  o.self = o;
  assert.equal(code(() => encode(o)), 'max_depth');
  assert.equal(code(() => decode(Buffer.concat([Buffer.alloc(100000, 0x91), Buffer.from([0xc0])]))), 'max_depth');
  assert.doesNotThrow(() => decode(Buffer.concat([Buffer.alloc(10, 0x91), Buffer.from([0xc0])]), { maxDepth: 10 }));
});

const ROWS = Array.from({ length: 100 }, (_, i) => ({ id: i, name: `user${i}`, email: `u${i}@example.com`, active: i % 2 === 0 }));

test('tabular encoding is smaller and lossless', () => {
  const tab = encode(ROWS);
  const plain = encode(ROWS, { autoTabular: false });
  assert.ok(tab.length < 0.7 * plain.length);
  assert.deepStrictEqual(decode(tab), ROWS);
  assert.deepStrictEqual(decode(plain), ROWS);
  // class instances and Maps count as rows too (logical maps)
  const asMaps = ROWS.map((r) => new Map(Object.entries(r)));
  assert.equal(Buffer.compare(encode(asMaps), tab), 0);
  // toJSON on rows runs once and its result is a row
  let calls = 0;
  const viaToJSON = ROWS.map((r) => ({ toJSON() { calls++; return r; } }));
  assert.equal(Buffer.compare(encode(viaToJSON), tab), 0);
  assert.equal(calls, ROWS.length);
});

test('compression, signing and envelope options', () => {
  const packed = encode(ROWS, { compress: true });
  assert.equal(packed.subarray(0, 4).toString(), 'BTON');
  assert.ok(packed.length < encode(ROWS).length / 2);
  assert.deepStrictEqual(decode(packed), ROWS);
  assert.equal(code(() => decode(packed, { autoDecompress: false })), 'invalid_envelope');
  assert.equal(code(() => decode(encode({ blob: Buffer.alloc(8 << 20) }, { compress: true }), { maxDecompressedSize: 1 << 20 })), 'size_limit');
  if (!btoon.compressionAvailable('snappy')) {
    assert.equal(code(() => encode(1, { compress: true, compression: 'snappy' })), 'unsupported_compression');
  }
  assert.equal(code(() => encode(1, { compression: 'nope' })), 'invalid_argument');

  const key = 'k'.repeat(32);
  const sealed = encode(ROWS, { hmacKey: key, compress: true });
  assert.equal(sealed.subarray(0, 4).toString(), 'BTSG');
  assert.deepStrictEqual(decode(sealed, { hmacKey: Buffer.from(key) }), ROWS);
  assert.equal(code(() => decode(sealed)), 'authentication_failed');
  assert.equal(code(() => decode(sealed, { hmacKey: 'x'.repeat(32) })), 'authentication_failed');
  assert.equal(code(() => decode(encode(1), { hmacKey: '' })), 'invalid_argument');
  assert.equal(code(() => encode(1, { hmacKey: new Uint8Array(0) })), 'invalid_argument');
});

test('error codes for hostile input', () => {
  for (const [hex, expected] of [['81', 'truncated'], ['ddffffffff', 'truncated'], ['0102', 'trailing_data'],
    ['a1ff', 'invalid_utf8'], ['c1', 'invalid_marker'], ['810101', 'non_string_key'], ['82a16101a16102', 'duplicate_key']]) {
    assert.equal(code(() => decode(Buffer.from(hex, 'hex'))), expected, hex);
  }
  assert.equal(decode(Buffer.from('0102', 'hex'), { strict: false }), 1);
  assert.equal(code(() => decode('not bytes')), 'invalid_argument');
});

test('async APIs', async () => {
  const sealed = await encodeAsync(ROWS, { compress: true, hmacKey: 'secret-key-secret-key-secret-key' });
  assert.deepStrictEqual(await decodeAsync(sealed, { hmacKey: 'secret-key-secret-key-secret-key' }), ROWS);
  assert.deepStrictEqual(await decodeAsync(new Uint8Array(encode(ROWS))), ROWS);
  await assert.rejects(decodeAsync(Buffer.from('92', 'hex')), (e) => e instanceof BtoonError && e.code === 'truncated');
  await assert.rejects(encodeAsync(Symbol('x')), (e) => e instanceof BtoonError && e.code === 'invalid_argument');
  // many concurrent decodes on the thread pool
  const data = encode(ROWS);
  const results = await Promise.all(Array.from({ length: 64 }, () => decodeAsync(data)));
  for (const r of results) assert.deepStrictEqual(r, ROWS);
});

test('MessagePack interoperability', async () => {
  const msgpack = await import('@msgpack/msgpack');
  const doc = { b: [1, 2.5, null, true], a: { x: 'y', bin: Uint8Array.from([1]) } };
  const viaMsgpack = msgpack.decode(encode(doc, { autoTabular: false }));
  assert.deepStrictEqual(Object.keys(viaMsgpack), ['a', 'b']); // canonical: sorted keys
  assert.deepStrictEqual(viaMsgpack.b, doc.b);
  assert.equal(viaMsgpack.a.x, 'y');
  assert.deepStrictEqual([...viaMsgpack.a.bin], [1]); // @msgpack/msgpack returns a Buffer in Node
  const fromMsgpack = decode(msgpack.encode(doc));
  assert.deepStrictEqual(fromMsgpack.b, doc.b);
  assert.deepStrictEqual([...fromMsgpack.a.bin], [1]);
  const d = new Date('2024-05-01T00:00:00.250Z');
  assert.equal(decode(msgpack.encode(d)).getTime(), d.getTime()); // MessagePack timestamp ext
  assert.equal(msgpack.decode(encode(d)).getTime(), d.getTime());
});

test('ESM entry point', async () => {
  const esm = await import('../index.mjs');
  assert.equal(typeof esm.encode, 'function');
  assert.equal(esm.default.VERSION, require('../package.json').version);
  assert.equal(btoon.VERSION, require('../package.json').version);
  assert.deepStrictEqual(esm.decode(esm.encode({ ok: 1 })), { ok: 1 });
});

test('fuzz: hostile bytes only ever raise BtoonError', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vectorsPath = [path.join(__dirname, '../core/tests/vectors/btoon-vectors.json'),
    path.join(__dirname, '../../btoon-core/tests/vectors/btoon-vectors.json')].find((p) => fs.existsSync(p));
  const seeds = JSON.parse(fs.readFileSync(vectorsPath, 'utf8')).vectors.map((v) => Buffer.from(v.hex, 'hex')).filter((b) => b.length);
  let state = 0x12345678;
  const rand = (n) => { state = (state * 1103515245 + 12345) >>> 0; return state % n; };
  let decoded = 0;
  for (let i = 0; i < 20000; i++) {
    const buf = Buffer.from(seeds[rand(seeds.length)]);
    for (let m = 0; m < 1 + rand(3); m++) buf[rand(buf.length)] = rand(256);
    for (const strict of [true, false]) {
      try {
        const v = decode(buf, { strict, timestamps: 'object' });
        decoded++;
        if (strict) assert.deepStrictEqual(decode(encode(v), { timestamps: 'object' }), v);
      } catch (e) {
        if (!(e instanceof BtoonError)) throw e;
      }
    }
  }
  assert.ok(decoded > 1000);
});

// Instants beyond Date's range (±8.64e15 ms) used to decode to Invalid Date with the default
// timestamps: 'date', silently destroying valid documents from other libraries: an INT64_MAX
// "never" sentinel, or seconds = 1e13. Like @btoon/js, they decode to a Timestamp instead.
test('timestamps outside the range of Date decode to Timestamp, not Invalid Date', async () => {
  const i64 = (n) => {
    const b = Buffer.alloc(8);
    b.writeBigInt64BE(BigInt(n));
    return b.toString('hex');
  };
  const u32 = (n) => n.toString(16).padStart(8, '0');
  const ts = (s, ns = 0) => Buffer.from(`c70cff${u32(ns)}${i64(s)}`, 'hex'); // 12-byte timestamp
  const tsOffset = (s, off) => Buffer.from(`c70eff${u32(0)}${i64(s)}${(off & 0xffff).toString(16).padStart(4, '0')}`, 'hex');
  const dateExt = (ms) => Buffer.from(`d7fe${i64(ms)}`, 'hex'); // BTOON date (-2): int64 milliseconds
  const INT64_MAX = 2n ** 63n - 1n;
  const MAX_S = 8_640_000_000_000n; // Date's range, in seconds
  const MAX_MS = 8.64e15;
  const timestamp = (v, s, ns = 0, off = undefined) => {
    assert.ok(v instanceof Timestamp, `expected a Timestamp, got ${v instanceof Date ? `Date(${v.getTime()})` : v}`);
    assert.deepStrictEqual([v.seconds, v.nanoseconds, v.offsetMinutes], [BigInt(s), ns, off]);
  };
  const date = (v, ms) => {
    assert.ok(v instanceof Date, `expected a Date, got ${v}`);
    assert.equal(v.getTime(), ms);
  };
  for (const dec of [decode, (b) => decodeAsync(b)]) {
    timestamp(await dec(ts(INT64_MAX)), INT64_MAX);
    timestamp(await dec(ts(-(2n ** 63n), 5)), -(2n ** 63n), 5);
    timestamp(await dec(ts(1e13)), 1e13);
    timestamp(await dec(ts(-1e13)), -1e13);
    timestamp(await dec(tsOffset(1e13, -330)), 1e13, 0, -330); // the offset is kept
    timestamp(await dec(dateExt(INT64_MAX)), INT64_MAX / 1000n, 807_000_000);
    // The boundaries are Date's own, to the millisecond.
    date(await dec(ts(MAX_S, 999_999)), MAX_MS);
    timestamp(await dec(ts(MAX_S, 1_000_000)), MAX_S, 1_000_000);
    date(await dec(ts(-MAX_S)), -MAX_MS);
    timestamp(await dec(ts(-MAX_S - 1n, 999_999_999)), -MAX_S - 1n, 999_999_999);
    date(await dec(dateExt(MAX_MS)), MAX_MS);
    timestamp(await dec(dateExt(MAX_MS + 1)), MAX_S, 1_000_000);
    timestamp(await dec(dateExt(-MAX_MS - 1)), -MAX_S - 1n, 999_000_000);
    date(await dec(tsOffset(1, 60)), 1000); // in range: a Date, the offset dropped (as before)
  }
  // Nothing is lost: the Timestamp re-encodes to the same bytes.
  assert.equal(encode(decode(ts(INT64_MAX))).toString('hex'), ts(INT64_MAX).toString('hex'));
  const doc = decode(encode({ never: decode(ts(INT64_MAX)), when: new Date(0) }));
  timestamp(doc.never, INT64_MAX);
  date(doc.when, 0);
  // toDate() throws rather than returning Invalid Date.
  assert.equal(code(() => new Timestamp(INT64_MAX).toDate()), 'invalid_argument');
  assert.equal(code(() => new Timestamp(MAX_S, 1_000_000).toDate()), 'invalid_argument');
  assert.equal(new Timestamp(MAX_S, 999_999).toDate().getTime(), MAX_MS);
  assert.equal(new Timestamp(-MAX_S).toDate().getTime(), -MAX_MS);
});

// new Timestamp(2n ** 64n) used to encode as the epoch and 2n ** 63n as -2^63: the binding
// ignored napi_get_value_bigint_int64's lossless flag. An offset, nanoseconds or Ext type
// assigned after construction wrapped the same way (Ext type 300 became 44). Like @btoon/js,
// these throw BtoonError 'invalid_argument', in the constructors and again in encode.
test('Timestamp and Ext fields out of range throw instead of wrapping', async () => {
  for (const s of [2n ** 64n + 5n, 2n ** 63n, -(2n ** 63n) - 1n, 2 ** 63, -(2 ** 64), 1.5, NaN, 'x', undefined]) {
    assert.equal(code(() => new Timestamp(s, 0)), 'invalid_argument', `seconds ${String(s)}`);
  }
  for (const s of [2n ** 63n - 1n, -(2n ** 63n), 2 ** 62]) {
    const t = new Timestamp(s, 999_999_999, -60);
    assert.deepStrictEqual(decode(encode(t), { timestamps: 'object' }), t);
  }
  for (const [ns, off] of [[1e9, undefined], [-1, undefined], [0.5, undefined], ['1', undefined], [0, 1081], [0, -1081], [0, 1.5], [0, null]]) {
    assert.equal(code(() => new Timestamp(0, ns, off)), 'invalid_argument', `nanoseconds ${ns}, offset ${off}`);
  }
  for (const type of [128, -129, 1.5, '5', NaN, undefined]) {
    assert.equal(code(() => new Ext(type, [])), 'invalid_argument', `Ext type ${String(type)}`);
  }
  // The fields are writable (as in @btoon/js), so encode checks them again.
  const mutations = [
    [() => new Timestamp(0), (t) => { t.seconds = 2n ** 64n; }],
    [() => new Timestamp(0), (t) => { t.seconds = 2n ** 63n; }],
    [() => new Timestamp(0), (t) => { t.seconds = -(2n ** 63n) - 1n; }],
    [() => new Timestamp(0), (t) => { t.seconds = 5; }],
    [() => new Timestamp(0), (t) => { t.nanoseconds = 1.9; }],
    [() => new Timestamp(0), (t) => { t.nanoseconds = 1e9; }],
    [() => new Timestamp(0), (t) => { t.nanoseconds = 2 ** 32 + 1; }],
    [() => new Timestamp(0, 0, 60), (t) => { t.offsetMinutes = 65536 + 60; }],
    [() => new Timestamp(0, 0, 60), (t) => { t.offsetMinutes = 1081; }],
    [() => new Timestamp(0, 0, 60), (t) => { t.offsetMinutes = '60'; }],
    [() => new Ext(1, [1]), (e) => { e.type = 300; }],
    [() => new Ext(1, [1]), (e) => { e.type = -129; }],
    [() => new Ext(1, [1]), (e) => { e.type = 1.5; }],
    [() => new Ext(1, [1]), (e) => { e.type = '1'; }],
  ];
  for (const [make, mutate] of mutations) {
    const v = make();
    mutate(v);
    const what = `${v.constructor.name} ${mutate}`;
    assert.equal(code(() => encode(v)), 'invalid_argument', what);
    assert.equal(code(() => encode([{ v }, { v }])), 'invalid_argument', what);
    await assert.rejects(encodeAsync(v), (e) => e instanceof BtoonError && e.code === 'invalid_argument', what);
  }
});

// Node-API's napi_get_prototype never runs a Proxy's getPrototypeOf trap and reports null for
// every Proxy, so each one encoded as a plain object: a proxied [10, 20, 30] (Vue's ref(), MobX
// observable arrays) became {"0": 10, ...}, a reactive Map {}, and a proxied class instance
// skipped its prototype toJSON(). Proxies now encode like their targets, as in @btoon/js.
test('Proxy-wrapped arrays, Maps and class instances encode like their targets', () => {
  const same = (v, expected) => assert.equal(encode(v).toString('hex'), encode(expected).toString('hex'));
  same(new Proxy([10, 20, 30], {}), [10, 20, 30]);
  same(new Proxy([], {}), []);
  same(new Proxy(new Proxy([1, [2]], {}), {}), [1, [2]]);
  same(new Proxy([1, 2], { getPrototypeOf: () => Object.prototype }), [1, 2]); // Array.isArray decides
  same({ list: new Proxy(['a', 'b'], {}) }, { list: ['a', 'b'] });
  same(new Proxy(ROWS, {}), ROWS); // still tabular
  same(ROWS.map((row) => new Proxy(row, {})), ROWS);
  // Vue's and MobX's reactive Maps trap `get` and run the Map methods on the target.
  const reactive = (target) =>
    new Proxy(target, {
      get(t, key) {
        const v = Reflect.get(t, key, t);
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
  same(reactive(new Map([['b', 1], ['a', [2]]])), { a: [2], b: 1 });
  same([reactive(new Map([['k', 1]])), reactive(new Map([['k', 2]]))], [{ k: 1 }, { k: 2 }]);
  class Secret {
    constructor() {
      this.secret = 's';
    }
    toJSON() {
      return 'public';
    }
  }
  same(new Proxy(new Secret(), {}), 'public');
  same(new Proxy({ b: 1, a: 2 }, {}), { a: 2, b: 1 });
  same(Object.assign(Object.create(null), { b: 1, a: 2 }), { a: 2, b: 1 }); // still a plain object
  // A bare Proxy of a Map can't run Map methods, and a Proxy of a Date has no time value: these
  // throw (as in @btoon/js) instead of encoding as {}.
  assert.throws(() => encode(new Proxy(new Map([['a', 1]]), {})), TypeError);
  assert.equal(code(() => encode(new Proxy(new Date(0), {}))), 'invalid_argument');
  const { proxy, revoke } = Proxy.revocable([1], {});
  revoke();
  assert.throws(() => encode(proxy), TypeError);
});

// SPEC §8: an empty key is a misconfiguration, not "no key" (core signs and verifies nothing
// with an empty key). Every entry point rejects one; only an absent key means no HMAC.
test('an empty hmacKey is invalid_argument on every entry point; undefined means no key', async () => {
  const doc = encode({ a: 1 });
  const sealed = encode({ a: 1 }, { hmacKey: 'k'.repeat(32) });
  for (const hmacKey of ['', new Uint8Array(0), Buffer.alloc(0), new Uint8Array(new ArrayBuffer(8), 8)]) {
    const isInvalid = (e) => e instanceof BtoonError && e.code === 'invalid_argument';
    assert.equal(code(() => encode({ a: 1 }, { hmacKey })), 'invalid_argument');
    assert.equal(code(() => decode(doc, { hmacKey })), 'invalid_argument');
    assert.equal(code(() => decode(sealed, { hmacKey })), 'invalid_argument');
    await assert.rejects(encodeAsync({ a: 1 }, { hmacKey }), isInvalid);
    await assert.rejects(decodeAsync(doc, { hmacKey }), isInvalid);
    await assert.rejects(decodeAsync(sealed, { hmacKey }), isInvalid);
  }
  assert.deepStrictEqual(encode({ a: 1 }, { hmacKey: undefined }), doc);
  assert.deepStrictEqual(decode(doc, { hmacKey: undefined }), { a: 1 });
  assert.equal(code(() => decode(sealed, { hmacKey: undefined })), 'authentication_failed');
});

// A string key is used as its UTF-8 bytes, and UTF-8 has no form for a lone surrogate:
// Buffer.from wrote U+FFFD instead, so 'k\ud800', 'k\udfff' and 'k�' were one key, and
// each verified documents signed with the others. Like @btoon/js, such a key is invalid_argument.
test('an hmacKey string with a lone surrogate is invalid_argument on every entry point', async () => {
  const sealed = encode({ a: 1 }, { hmacKey: 'k�' });
  const isInvalid = (e) => e instanceof BtoonError && e.code === 'invalid_argument' && e.message === 'hmacKey string contains a lone surrogate';
  for (const hmacKey of ['k\ud800', 'k\udfff', '\udc00k', 'a\ud83db', '\ud800𐀀', 'x'.repeat(100) + '\udbff']) {
    assert.throws(() => encode({ a: 1 }, { hmacKey }), isInvalid);
    assert.throws(() => decode(sealed, { hmacKey }), isInvalid);
    await assert.rejects(encodeAsync({ a: 1 }, { hmacKey }), isInvalid);
    await assert.rejects(decodeAsync(sealed, { hmacKey }), isInvalid);
  }
  // Well-formed keys work, astral characters and a real U+FFFD included.
  for (const hmacKey of ['k�', 'key 😀', 'ключ']) {
    assert.deepStrictEqual(decode(encode({ a: 1 }, { hmacKey }), { hmacKey }), { a: 1 });
    assert.deepStrictEqual(await decodeAsync(await encodeAsync({ a: 1 }, { hmacKey }), { hmacKey }), { a: 1 });
  }
});
