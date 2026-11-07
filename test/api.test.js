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
  assert.equal(esm.default.VERSION, '0.1.0');
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
