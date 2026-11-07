# Changelog

## 0.1.0 (unreleased)

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
