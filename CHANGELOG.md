# Changelog

## 0.1.2 (2026-11-13)

- **Core:** built on btoon-core 0.1.5. Nested containers no longer reserve memory against
  the same input at every level. On the review's inputs, 1 MiB of nested headers reserved
  5 GB on 0.1.4; now it peaks near 100 MB.
- **Fixed (packaging):** the Linux glibc prebuilds needed glibc 2.38 (`GLIBC_2.38`,
  `GLIBCXX_3.4.32`) because they were built on Ubuntu 24.04. They didn't load on Debian 12
  (the default `node:22` images), Ubuntu 22.04, RHEL 9 or Amazon Linux 2023 / AWS Lambda.
  They're now built in the manylinux_2_28 images and need glibc 2.28, like Node.js's own
  Linux builds. The release workflow checks the symbol versions and load-tests the package
  on Debian 11 and 12, Ubuntu 22.04, AlmaLinux 8, Amazon Linux 2023 and Alpine.
- **Fixed:** with the default `timestamps: 'date'`, an instant outside the range of `Date`
  (±8.64e15 ms) decoded to `Invalid Date`, losing the value. Documents from other libraries
  carry such instants, for example an INT64_MAX "never" sentinel or seconds = 1e13. They
  now decode to a `Timestamp`, as in `@btoon/js`. **Behavior change:** for those instants
  `decode` returns a `Timestamp`, not a `Date`.
- **Fixed:** `Timestamp` accepted seconds outside the int64 range, and `encode` wrapped them
  silently: `new Timestamp(2n ** 64n)` encoded as the epoch, `2n ** 63n` as -2^63.
  Nanoseconds, offsets and `Ext` types assigned after construction wrapped the same way
  (`Ext` type 300 became 44). The constructors and `encode` now reject them with
  `BtoonError` code `invalid_argument`, as `@btoon/js` does. **Behavior changes:**
  - `new Timestamp()`, `new Ext()` and `Timestamp.fromDate(invalidDate)` throw `BtoonError`
    (`invalid_argument`) where they threw `RangeError` (or `BigInt()`'s `TypeError` or
    `SyntaxError` for seconds that aren't a number).
  - `timestamp.toDate()` throws `BtoonError` (`invalid_argument`) outside the range of
    `Date`, where it returned `Invalid Date`.
- **Fixed:** every `Proxy` encoded as a plain object, because Node-API reports a null
  prototype for any Proxy. This hit Vue and MobX reactive state: a proxied `[10, 20, 30]`
  became `{"0": 10, "1": 20, "2": 30}`, a reactive `Map` became `{}`, and a proxied class
  instance skipped its prototype's `toJSON()`. Proxies now encode like their targets; as in
  `@btoon/js`, `Array.isArray` and `Object.getPrototypeOf` decide. A bare `Proxy` of a
  `Map`, whose methods can't run on the proxy, now throws the Map method's `TypeError`, and
  a `Proxy` of a `Date` throws `invalid_argument`. Both encoded as `{}` before. Encoding
  plain objects and arrays costs the same as before.
- **Fixed:** an `hmacKey` string with a lone surrogate was signed with U+FFFD in its place,
  so `'k\ud800'`, `'k\udfff'` and `'k�'` were one key, and each one verified documents
  signed with the others. **Behavior change:** such a key now throws `BtoonError`
  `invalid_argument` on `encode`, `decode`, `encodeAsync` and `decodeAsync`, as in
  `@btoon/js`.

## 0.1.1 (2026-11-13)

- **Fixed (crashes):**
  - A getter, `toJSON` or Proxy trap that threw during `encode` could crash the process
    (segfault on the linux-arm64 prebuild). A failed Node-API call left an uninitialized
    value behind, which was then used. Every Node-API status is now checked, and the
    error that was thrown reaches the caller unchanged.
  - `worker.terminate()` while an `encodeAsync` or `decodeAsync` of that worker was
    running aborted the whole process (`std::terminate` from the completion callback).
    The callbacks now give up quietly when the worker is gone, and `decodeAsync` no
    longer reads the options object after it returns.
- **Fixed:** `Float16Array` encoded as an empty binary on Node 24+, and as half its bytes
  on Node 22 with `--js-float16array`. Every typed array except `Float32Array` and
  `Float64Array` now encodes all of its bytes. The same goes for decode input and `Ext`
  data given as such a view.
- **Core:** built on btoon-core 0.1.4 (was 0.1.0). Encoding and decoding are unchanged.
  Source builds on Android work again: core 0.1.2 removed the `shm_open` dependency.

## 0.1.0 (2026-11-07)

A rewrite on btoon-core 0.1.0 (BTOON spec 0.1). The API matches `@btoon/js`.

- **Fixed:**
  - `compress: true` didn't compress, and `Date` values decoded as garbage.
  - A missing `algorithm` silently disabled compression.
  - `NaN` and other non-integers hit undefined behavior in integer detection.
  - Every core decoder bug from 0.0.x is gone too (heap over-read, stack overflow,
    unbounded allocations).
- **New types:**
  - `bigint` (64-bit or the bigint extension);
  - `Uint8Array`, `ArrayBuffer`, `DataView` and other typed arrays as binary;
  - `Float32Array`/`Float64Array` as vectors;
  - `Map`; `toJSON()` and class instances, with `JSON.stringify` semantics;
  - `Timestamp` (nanoseconds and UTC offset); `Ext`.
- **New API:**
  - `encodeAsync`/`decodeAsync` (thread pool), `compressionAvailable()`, ESM entry point;
  - `BtoonError` with spec error codes;
  - options `compression`, `hmacKey`, `maxDepth`, `strict`, `maxDecompressedSize`,
    `autoDecompress`, `timestamps`, `bigint`.
- **Safety:** cycles throw `max_depth`. `"__proto__"` keys can't change prototypes.
  Empty HMAC keys are rejected.
- **Build:**
  - node-gyp compiles core sources directly. There's no external static library, and
    the old `find_btoon_*` scripts and `/usr/local` include paths are gone.
  - One Node-API prebuild per platform via prebuildify, replacing the per-Node-version
    `prebuild`.
  - Tests use `node:test` (no mocha/chai).

## 0.0.1 – 0.0.7

Early releases.
