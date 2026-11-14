'use strict';
// API parity with @btoon/js, the reference implementation.
// - parity-cases.cjs (the same file as @btoon/js's test/parity-cases.cjs) lists cases with the
//   outcome both packages must give. They run here against this package.
// - Where @btoon/js is available (BTOON_JS=<its package directory>, or installed), the same
//   cases and a stream of random values run through both packages side by side: results,
//   error codes and messages must be identical. Otherwise that part is skipped.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const btoon = require('..');
const { cases, matches, outcome, show } = require('./parity-cases.cjs');

const describe = (o) => JSON.stringify(o, (k, v) => (v instanceof RegExp ? String(v) : v));

// BTOON_JS set means the comparison must run: failing to load it is an error, not a skip.
function loadReference() {
  if (process.env.BTOON_JS) return require(process.env.BTOON_JS);
  try {
    return require('@btoon/js');
  } catch {
    return undefined;
  }
}
const js = loadReference();
const noReference = js === undefined && 'set BTOON_JS to an @btoon/js package directory to compare side by side';

test('parity cases: the outcomes @btoon/js gives', () => {
  const failures = [];
  const list = cases(btoon);
  assert.ok(list.length >= 100);
  for (const [name, fn, expected] of list) {
    const got = outcome(fn);
    if (!matches(got, expected)) failures.push(`${name}: expected ${describe(expected)}, got ${describe(got)}`);
  }
  assert.deepStrictEqual(failures, []);
});

test('parity cases, side by side with @btoon/js: same results, codes and messages', { skip: noReference }, () => {
  assert.equal(js.VERSION, btoon.VERSION);
  assert.equal(js.SPEC_VERSION, btoon.SPEC_VERSION);
  const theirs = new Map(cases(js).map(([name, fn]) => [name, fn]));
  const failures = [];
  for (const [name, fn] of cases(btoon)) {
    const a = outcome(fn);
    const b = outcome(theirs.get(name));
    // Decoders' messages differ (core's and @btoon/js's own); everything else must match.
    const decoderError = ['size_limit', 'authentication_failed', 'truncated', 'trailing_data'].includes(a.error);
    if (decoderError ? a.error !== b.error : describe(a) !== describe(b)) failures.push(`${name}: native ${describe(a)}, @btoon/js ${describe(b)}`);
  }
  assert.deepStrictEqual(failures, []);
});

// Random values built the same way for each package (with its own classes), as in review
// 2026-11-13's differential probe: both must write the same bytes or fail the same way, and
// decode those bytes to the same values in every mode.
test('random values, side by side with @btoon/js', { skip: noReference }, () => {
  const KEYS = ['a', 'b', 'id', '', 'é', '日', '😀', 'ab', '__proto__', 'constructor', 'x'.repeat(33), '10', '9', 'toJSON'];
  function generator(lib, seed) {
    let s = seed;
    const rnd = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x80000000;
    };
    const ri = (n) => Math.floor(rnd() * n);
    const pick = (a) => a[ri(a.length)];
    function scalar() {
      switch (ri(18)) {
        case 0: return null;
        case 1: return undefined;
        case 2: return rnd() < 0.5;
        case 3: return ri(1000) - 500;
        case 4: return pick([2 ** 53, -(2 ** 53), 2 ** 53 - 1, 1e21, -0, NaN, Infinity, 0.1, 2 ** 64, 2 ** 63, 2 ** 32, -(2 ** 31) - 1]);
        case 5: return pick([2n ** 63n, 2n ** 64n - 1n, 2n ** 64n, -(2n ** 63n) - 1n, 5n, -5n, 2n ** 200n]);
        case 6: return pick(['', 'hello', 'Grüße', '😀😀', 'x'.repeat(300)]);
        case 7: return Uint8Array.from({ length: ri(5) }, () => ri(256));
        case 8: return new Float32Array([1.5, -2]);
        case 9: return new Float64Array([0.1]);
        case 10: return new Date(pick([0, -1, 1.7e12, 8.64e15, -62135596800000]));
        case 11: return new lib.Timestamp(BigInt(ri(1e9) - 5e8), ri(1e9), rnd() < 0.3 ? ri(2161) - 1080 : undefined);
        case 12: return new lib.Ext(pick([1, 42, -100, -7]), Uint8Array.from({ length: ri(20) }, () => ri(256)));
        case 13: return new lib.BtoonDate(BigInt(ri(2 ** 31)) * pick([1n, -1000n, 4294967296n]));
        case 14: return new lib.BtoonDateTime(BigInt(ri(2 ** 31)) * pick([1n, -1000000n, 4294967296n]));
        case 15: return pick([new Number(5), new String('s'), new Boolean(true), Object(7n), { toJSON: () => 'j' }]);
        case 16: return new Map([['k', ri(10)], ['l', 'v']]);
        default: return new Int16Array([1, -1]);
      }
    }
    function value(d = 0) {
      const c = d > 3 ? 0 : ri(10);
      if (c < 5) return scalar();
      if (c < 7) return Array.from({ length: ri(5) }, () => value(d + 1));
      if (c < 9) {
        const o = {};
        for (let i = ri(5); i > 0; i--) Object.defineProperty(o, pick(KEYS), { value: value(d + 1), enumerable: true, writable: true, configurable: true });
        return rnd() < 0.2 ? new Map(Object.entries(o)) : o;
      }
      const keys = [...new Set(Array.from({ length: 1 + ri(3) }, () => pick(KEYS)))];
      return Array.from({ length: 2 + ri(12) }, () => Object.fromEntries(keys.map((k) => [k, value(d + 2)])));
    }
    return value;
  }
  const hex = (b) => Buffer.from(b).toString('hex');
  const run = (fn) => {
    try {
      return { ok: fn() };
    } catch (e) {
      return { error: e.code ?? e.name };
    }
  };
  const nativeValue = generator(btoon, 99);
  const jsValue = generator(js, 99);
  let differences = 0;
  const examples = [];
  for (let i = 0; i < 5000; i++) {
    const vn = nativeValue();
    const vj = jsValue();
    const a = run(() => hex(btoon.encode(vn)));
    const b = run(() => hex(js.encode(vj)));
    let same = describe(a) === describe(b);
    if (same && a.ok) {
      const bytes = Buffer.from(a.ok, 'hex');
      for (const o of [{}, { timestamps: 'object' }, { bigint: 'always' }]) {
        if (describe(show(btoon.decode(bytes, o))) !== describe(show(js.decode(bytes, o)))) same = false;
      }
    }
    if (!same) {
      differences++;
      if (examples.length < 3) examples.push(`#${i}: native ${describe(a).slice(0, 200)}, @btoon/js ${describe(b).slice(0, 200)}`);
    }
  }
  assert.deepStrictEqual(examples, []);
  assert.equal(differences, 0);
});

// Values whose getters, toJSON() methods and Proxy traps throw, or change what is being encoded
// (emptying arrays, deleting keys, swapping rows, lying about lengths), all drawing on one
// random stream. The two packages must run that user code in the same order and the same
// number of times: the stream ends in the same state after every value, and each value ends the
// same way (bytes, error code and message, or the same exception).
test('hostile getters, toJSON() and Proxy traps, side by side with @btoon/js', { skip: noReference }, () => {
  function run(lib, seed, count) {
    let s = seed;
    const rnd = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x80000000;
    };
    const ri = (n) => Math.floor(rnd() * n);
    const pick = (a) => a[ri(a.length)];
    let root;
    function chaos() {
      switch (ri(8)) {
        case 0:
          if (Array.isArray(root)) root.length = ri(3);
          return 1;
        case 1:
          if (root && typeof root === 'object') for (const k of Object.keys(root)) delete root[k];
          return 2;
        case 2:
          throw new Error('chaos');
        case 3:
          return value(2);
        case 4:
          if (Array.isArray(root) && root.length) root[ri(root.length)] = pick([null, 5, new Map([['a', 1]]), { a: 1 }]);
          return 3;
        case 5:
          return new Proxy({ a: 1 }, { ownKeys: () => (ri(2) ? ['a'] : ['a', 'b']), getOwnPropertyDescriptor: () => ({ value: 1, enumerable: true, configurable: true }) });
        default:
          return 'x';
      }
    }
    function value(d = 0) {
      switch (d > 3 ? ri(4) : ri(12)) {
        case 0: return ri(100);
        case 1: return 'str';
        case 2: return null;
        case 3: return new lib.BtoonDate(BigInt(ri(1e6)));
        case 4: {
          const o = {};
          for (let i = ri(4); i > 0; i--) {
            const k = pick(['a', 'b', 'c', 'toJSON', 'k']);
            if (rnd() < 0.3) Object.defineProperty(o, k, { enumerable: true, configurable: true, get: chaos });
            else Object.defineProperty(o, k, { enumerable: true, configurable: true, writable: true, value: value(d + 1) });
          }
          return o;
        }
        case 5: return Array.from({ length: ri(6) }, () => value(d + 1));
        case 6: {
          const rows = Array.from({ length: 2 + ri(8) }, () => ({ a: value(d + 2), b: value(d + 2) }));
          if (rnd() < 0.5) Object.defineProperty(rows[0], 'b', { enumerable: true, get: chaos });
          return rows;
        }
        case 7: return { toJSON: () => (rnd() < 0.5 ? chaos() : value(d + 1)) };
        case 8: return new Map([['a', value(d + 1)], ['b', value(d + 1)]]);
        case 9:
          return new Proxy(Array.from({ length: ri(4) }, () => value(d + 1)), {
            get: (t, k) => (k === 'length' && rnd() < 0.1 ? pick([-1, 1.5, 'x']) : rnd() < 0.05 ? chaos() : Reflect.get(t, k)),
          });
        case 10:
          return new Proxy(new Map([['a', 1]]), {
            get(t, k) {
              if (rnd() < 0.1) return chaos();
              const v = Reflect.get(t, k, t);
              return typeof v === 'function' ? v.bind(t) : v;
            },
          });
        default: return [new Number(ri(5)), Object(5n), new lib.Ext(5, Uint8Array.of(1)), new lib.Timestamp(1n)][ri(4)];
      }
    }
    const trace = [];
    for (let i = 0; i < count; i++) {
      root = value();
      let r;
      try {
        r = Buffer.from(lib.encode(root)).toString('hex');
      } catch (e) {
        r = e instanceof lib.BtoonError ? `BtoonError ${e.code}: ${e.message}` : `${e.name}: ${e.message}`;
      }
      trace.push(`${s} ${r}`);
    }
    return trace;
  }
  for (const seed of [7, 2026]) {
    const a = run(btoon, seed, 4000);
    const b = run(js, seed, 4000);
    const first = a.findIndex((x, i) => x !== b[i]);
    assert.equal(first, -1, first < 0 ? '' : `seed ${seed}, value #${first}: native ${a[first].slice(0, 200)}, @btoon/js ${b[first].slice(0, 200)}`);
  }
});
