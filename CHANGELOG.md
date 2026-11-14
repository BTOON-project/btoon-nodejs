# Changelog

## 0.3.0 (2026-11-14)

BTOON spec 0.3, on btoon-core 0.3.0: `SPEC_VERSION` is `'0.3'`. The wire format is unchanged.
Every BTOON type now round-trips, dates and datetimes included, and the API and its behavior
match `@btoon/js` 0.3.0 exactly, which is the reference: this release ports its option checks,
constructors and classification of values, and fixes the remaining findings of the 2026-11-13
review. Each behavior change is marked.

- **New: `BtoonDate` and `BtoonDateTime`**, typed values for the date (-2) and datetime (-3)
  extensions, which couldn't be written before. Both subclass `Timestamp` and hold the exact
  value on the wire, `epochMilliseconds` or `epochNanoseconds`, a `bigint` in the int64 range;
  `seconds` and `nanoseconds` describe the same instant, floored. The constructors take a
  `bigint` or a safe-integer `number`. `fromDate(date)`, `fromTimestamp(ts)` and `toDate()`
  convert; a date floors to the millisecond, and a `Timestamp` with a UTC offset or out of
  range is `invalid_argument`. `encode` writes them as `fixext 8` with a big-endian `i64`,
  table cells included. A raw `Ext(-2)`/`Ext(-3)` is still refused, now with a message that
  names these types.
- **Behavior change:** with `timestamps: 'object'`, a date decodes to a `BtoonDate` and a
  datetime to a `BtoonDateTime`, not a plain `Timestamp`, so a decoded document encodes back to
  the same bytes. Code that checks `instanceof Timestamp` or reads `seconds`/`nanoseconds` keeps
  working. With the default `'date'`, a date outside the range of `Date` decodes to a
  `BtoonDate` instead of a `Timestamp`.
- **Fixed (security):** `decode(view, { hmacKey })` of input in a `SharedArrayBuffer` verified
  the signature over shared memory and then parsed that memory again, which another thread
  can change in between: in the review, a worker flipping one byte got 223 forgeries through.
  Input in shared memory is now copied once, then verified and parsed. `decode` also accepts a
  `SharedArrayBuffer` itself now (it threw `invalid_argument`).
- **Fixed:** a `Map` subclass whose iterator repeats a key wrote that key twice. Maps are now
  read with the intrinsic `Map` methods, so a subclass's own iterator, `keys()` or `get()`
  can't change what is written. A Proxy of a `Map` (Vue's and MobX's reactive Maps) is read
  through its own `keys()` and `get()`, and one that repeats a key throws `invalid_argument`.
- **Fixed (parity with `@btoon/js`):** these encoded differently from `@btoon/js` and
  `JSON.stringify`:
  - `Number`, `String`, `Boolean` and `BigInt` wrapper objects encoded as `{}` (a `String`
    as `{"0": …}`). They're unwrapped now.
  - A `SharedArrayBuffer` encoded as `{}`; it's binary now.
  - A `Map` from another realm (a `vm` context) encoded as `{}`; it's a map now.
  - **Behavior change:** `toJSON()` is called once per value, as `JSON.stringify` does: a
    `toJSON()` result that has `toJSON()` itself is encoded by its own properties. A chain of
    `toJSON()` calls used to be followed, each adding a nesting level, so a class with
    `toJSON()` (a Decimal, an ObjectId) 128 arrays deep threw `max_depth`. `toJSON()` adds no
    nesting level now.
  - **Behavior change:** `bigint: 'always'` gives a `bigint` for every integer outside
    [-2^31, 2^32-1], which is what a canonical encoder writes as uint64, int64 or a bigint
    extension, and a `number` inside it. It used to give a `bigint` for every integer, so
    `decode(encode(5), { bigint: 'always' })` is now `5`, not `5n`. The type depends on the
    value, never on the encoding (spec §7), as in `@btoon/js`. `bigint: 'auto'` is unchanged.
- **Behavior change:** options are checked as in `@btoon/js`, with the same messages:
  - `compress`, `autoTabular`, `strict` and `autoDecompress` must be booleans (any value
    counted by its truthiness before);
  - `maxValues` and `maxDecompressedSize` must be non-negative safe integers; `null` is
    `invalid_argument` (it meant the default);
  - `maxDepth` may be 0 (only scalars encode or decode), as in `@btoon/js`;
  - options that aren't an object throw `invalid_argument`, and `null` options mean the
    defaults (a `null` threw a `TypeError`);
  - `codecs` (from `@btoon/js`) is checked the same way, but this package doesn't call
    caller-supplied codecs;
  - an `hmacKey` `Uint8Array` from another realm works.
- **Deprecated:** `compression: 'auto'` is an alias for `'zlib'` now, which is what it wrote
  (the builds have only zlib) and what spec §6 says encoders use when no algorithm is named.
  It still works, and emits a `DeprecationWarning` (code `BTOON_DEP_AUTO`) once per process; use
  `'zlib'` or leave the option out. `compressionAvailable('auto')` answers for zlib, so it's
  `true` (it was `false`). `@btoon/js` doesn't accept `'auto'`, so code shared with it
  shouldn't pass it.
- **Behavior change:** the constructors check their arguments as in `@btoon/js`:
  - `new Ext(type, data)` needs a `Uint8Array` (a `Buffer` is one). It converted array-likes
    and other typed arrays element by element, so a `Uint16Array` lost its high bytes. An
    `Ext` whose `data` was replaced by another typed array is refused on encode too.
  - `new Timestamp(seconds)` needs a `bigint` or a safe-integer `number`; strings and unsafe
    numbers went through `BigInt()`. `nanoseconds` still defaults to 0.
  - `Timestamp.fromDate()` of something that isn't a `Date` throws `invalid_argument`, not a
    `TypeError`; an invalid `Date` says "cannot convert an invalid Date".
  - A `Timestamp` whose `offsetMinutes` was set to `null` throws `invalid_argument` on encode;
    only `undefined` means no offset (`null` did too).
  - `BtoonError` takes `{ cause }`, as in `@btoon/js`.
- **Changed:** `instanceof BtoonError`, `Ext`, `Timestamp`, `BtoonDate` and `BtoonDateTime`
  check brands that `@btoon/js` shares, so values from either package (and any realm) are
  recognized by both packages' `instanceof` and encoders.
- **Changed:** user code runs as in `@btoon/js`. An object's own keys are read first, then each
  value as it is written, in key order (all values were read first, in property order); a
  table is written column by column from the rows as planned. The encoder's error messages
  are `@btoon/js`'s ("cannot encode a function", "maximum nesting depth exceeded (or the value
  is cyclic)", "expected a Date" for a Proxy of a Date, …).
- **Fixed:** `index.mjs` lacked `version` (and now exports `BtoonDate` and `BtoonDateTime`).
- **Fixed (types):** `index.d.ts` references the Node.js types it uses (`Buffer`), so it
  compiles without the consumer's own `types: ["node"]`. It declares `VERSION` and
  `SPEC_VERSION` as literals, `CompressionAlgorithm` (`Compression` stays as a deprecated
  alias), `BinaryInput`, `Codec` and `CodecRegistry`, `Ext` data as a `Uint8Array`, and
  `instanceof` narrowing.
- **Fixed (build):** `binding.gyp` compiled every btoon-core source, so a core module the addon
  doesn't use could break a source build: on Android, an older core's `shm_open` did. It now
  compiles only the seven sources the addon needs (`scripts/core-path.js`), and the package
  ships only those.
- **Docs:** the README explains source builds under npm 12, which runs a dependency's install
  script only after `npm install-scripts approve btoon` (then `npm rebuild btoon`; globally,
  `npm install -g btoon --allow-scripts=btoon`). The prebuilds don't need it. It no longer
  promises source builds with Zstd, LZ4, Brotli or Snappy, which `binding.gyp` can't produce:
  the package has zlib only. It documents the typed date values and what stays different from
  `@btoon/js` (`Buffer` results, `compressionAvailable()` and `version()`, `compression: 'auto'`,
  unused `codecs`, decoded key order).
- **Tests:** the conformance harness runs the 311 spec 0.3 vectors, re-encodes the date and
  datetime vectors from `BtoonDate` and `BtoonDateTime`, checks that every canonical vector
  decoded with `timestamps: 'object'` encodes back to its bytes (only `float/0` skips), and
  checks the JavaScript type of every integer in both `bigint` modes. New:
  `test/parity-cases.cjs`, the same cases `@btoon/js` runs with the same expected outcomes;
  side-by-side runs against `@btoon/js` when `BTOON_JS` points to it (the cases, random
  values, and hostile getters, `toJSON()` and Proxy traps, which must run identically); the
  typed-date tests of `@btoon/js`; a worker that rewrites a signed document in shared memory
  while it is decoded; a type test of `index.d.ts` with TypeScript; and a check that the build
  and the package use only the core sources the addon needs. CI has a `parity` job that runs the
  side-by-side comparison against btoon-javascript `main`, or a ref chosen when it's run by hand.

## 0.2.0 (2026-11-14)

BTOON spec 0.2, on btoon-core 0.2.0: `SPEC_VERSION` is `'0.2'`. The wire format is
unchanged, but decoding has new limits and encoding new rules, so some input that 0.1
accepted is now refused. These match `@btoon/js` 0.2. Each behavior change is marked.

- **New: the `maxValues` decode option** bounds how many values a document decodes to (spec
  §7.1), in `decode` and `decodeAsync`. The top-level value, every array element, object
  value and extension value, and every table row and cell count once; keys don't. Values
  inside a compression envelope count. It's validated like `maxDecompressedSize`: a
  non-negative safe integer, with `undefined` or `null` for the default. **Behavior
  change:** the default is 2^20 (1,048,576), and a document over it throws `BtoonError`
  `size_limit`. Pass a larger `maxValues` for bigger documents, such as a table of 100,000
  rows × 10 columns (1,100,001 values).
- **Behavior change:** `maxDecompressedSize` now defaults to 64 MiB, down from 256 MiB. It
  also bounds tables: rows × the total bytes of the column names (which are copied into
  every row) over the limit is `size_limit`. With `maxValues`, this bounds what a small
  input can make the decoder allocate: in 0.1, a few KB of compressed input could demand
  gigabytes.
- **Behavior change:** `maxDepth` above 1000 throws `BtoonError` `invalid_argument` in
  `encode`, `decode`, `encodeAsync` and `decodeAsync`. A raised limit used to let deep
  input or a deep value overflow the native stack and crash the process (about 30,000
  levels on the main thread, 15,000 in a worker). The default stays 128.
- **Behavior change:** `hmacKey: null` throws `invalid_argument` in `encode`, `decode`,
  `encodeAsync` and `decodeAsync`, as in `@btoon/js` (spec §8). It used to mean "no key", so
  a key read from an unset source silently turned signing and verification off. Only an
  absent key (`undefined`) means no key now. An empty key was already an error.
- **Behavior change:** encoding an `Ext` whose type BTOON defines itself (-1 to -6, and
  -10) throws `BtoonError` `invalid_argument` (spec §5.7), in `encode` and `encodeAsync`. It
  used to be written verbatim, so `new Ext(-4, [5])` produced the non-canonical `d4fc05`,
  and `new Ext(-1, [1, 2, 3])` a timestamp that every decoder rejects. Those types are
  written from `Date`, `Timestamp`, `bigint`, `Float32Array`/`Float64Array` and arrays of
  objects, so there is no longer a way to write the date (-2) and datetime (-3) extensions.
  As in `@btoon/js`, the `Ext` constructor still accepts every type in -128..127, and the
  types reserved for future versions (-7 to -9, -11 to -128) are written as given.
- **Behavior change:** with `strict: false`, keys and table column names must still be
  valid UTF-8 (`invalid_utf8`). Invalid ones used to become U+FFFD, which merged distinct
  keys and silently dropped values. String values are unchanged.
- **Behavior change:** table column names are checked front to back, each for UTF-8 and
  then against the earlier names. A duplicate name ahead of an invalid one is now
  `invalid_tabular` instead of `invalid_utf8`.
- **Docs:** the README's signing example no longer passes `process.env.BTOON_KEY` straight
  through, where an unset variable would have meant "unsigned".
- **Tests:** the conformance harness honors every vector option (`strict`, `max_depth`,
  `max_decompressed_size`, `max_values`, `hmac_key`), runs the `encode_error` vectors,
  compares float vector elements bit for bit (NaN payloads included), and runs every
  vector through `decodeAsync`/`encodeAsync` too. Canonical floats that aren't safe
  integers (2^53, 1e300, the largest double) are now re-encoded, as in `@btoon/js`.

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
