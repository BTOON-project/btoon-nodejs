# Changelog

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
