# btoon for Node.js

Native Node.js bindings for **BTOON**, a compact binary serialization format: **MessagePack
plus a columnar encoding for arrays of uniform objects**, with timestamps, dates, bigints,
float vectors and optional compression/signing. Built on the C++ reference implementation
([btoon-core](https://github.com/BTOON-project/btoon-core)), BTOON spec 0.3. The API and its
behavior are the same as [`@btoon/js`](https://github.com/BTOON-project/btoon-javascript),
the pure JavaScript implementation (see [Same as @btoon/js](#same-as-btoonjs)).

> **Most applications should use [`@btoon/js`](https://www.npmjs.com/package/@btoon/js)
> instead.** It has the same API and writes the same bytes, and in Node.js it is 4–7×
> faster than this addon (see [Performance](#performance)). Use this package when you
> want the C++ reference implementation itself.

## Install

```bash
npm install btoon
```

Prebuilt binaries (Node-API, Node ≥ 18) ship for Linux x64 (glibc and musl), Linux arm64 (glibc), macOS
arm64/x64 and Windows x64. The glibc ones need glibc 2.28 or newer, like Node.js's own Linux builds:
RHEL 8, Debian 10, Ubuntu 20.04 and Amazon Linux 2023 (AWS Lambda's `nodejs20.x` and later) all qualify.
They need no install script: the package finds its prebuild when it loads.

On other platforms, such as Linux arm64 with musl (Alpine) or Windows arm64, the addon is built
from source by the package's install script, which needs a C++20 compiler and Python (for
node-gyp). npm 12 runs a dependency's install script only once you approve it, so there approve
it and run it:

```bash
npm install btoon
npm install-scripts approve btoon   # npm 12+: records "allowScripts" in package.json
npm rebuild btoon                   # runs the install script: builds the addon
```

For a global install, pass the approval along: `npm install -g btoon --allow-scripts=btoon`.
Earlier npm versions run the install script without asking. The prebuilds and source builds
include zlib only (`compressionAvailable()` tells): this package has no build with Zstd, LZ4,
Brotli or Snappy. For those, use `@btoon/js` with a codec of your own (its `options.codecs`),
or btoon-core directly.

## Usage

```js
const btoon = require('btoon');            // or: import { encode, decode } from 'btoon'

const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i, name: `user${i}`, active: i % 2 === 0 }));

const bytes = btoon.encode(rows);           // Buffer; tables are stored column by column
btoon.decode(bytes);                        // deep-equals rows

btoon.encode(rows, { compress: true });     // zlib envelope, detected on decode
const key = process.env.BTOON_KEY ?? '';     // unset or empty: encode/decode throw, never skip the MAC
const sealed = btoon.encode(rows, { hmacKey: key });
btoon.decode(sealed, { hmacKey: key });

await btoon.decodeAsync(bytes);             // parsing runs on the libuv thread pool
```

## Types

| JavaScript → BTOON → JavaScript | Notes |
|---|---|
| `null`, `undefined` → `null` | Object properties set to `undefined` encode as nil |
| `boolean`, `string` | Strings are UTF-8. A lone surrogate throws `invalid_utf8`; clean such strings with `toWellFormed()` |
| `number` | Safe integers encode as integers. Everything else, including `-0`, NaN and ±Infinity, encodes as float64. |
| `bigint` | Uses 64-bit ints when it fits, the bigint extension otherwise. An integer decodes to a `number` in the safe range [-(2^53-1), 2^53-1] and to a `bigint` outside it; with `bigint: 'always'`, to a `number` only in [-2^31, 2^32-1] and to a `bigint` outside it, even when safe. The type depends on the value, never on its encoding. |
| `Buffer`, `Uint8Array`, other typed arrays, `ArrayBuffer`, `DataView` → `Buffer` | |
| `Float32Array`, `Float64Array` | Packed float vectors (little-endian); embeddings take 4 bytes per value |
| `Date` → `Date` | A timestamp. `Timestamp` keeps nanoseconds and a UTC offset (`timestamps: 'object'`). Instants outside the range of `Date` decode as `Timestamp` |
| `BtoonDate` | A date: `i64` milliseconds since the epoch. Decodes to `Date`, or `BtoonDate` with `timestamps: 'object'` (or outside the range of `Date`) |
| `BtoonDateTime` | A datetime: `i64` nanoseconds since the epoch. Decodes to `Date` (floored to the millisecond), or `BtoonDateTime` with `timestamps: 'object'` |
| arrays, plain objects, `Map` (string keys), class instances | Like `JSON.stringify`: own enumerable properties, and `toJSON()` is honored (called once; for a plain object, its own `toJSON`). `Number`, `String`, `Boolean` and `BigInt` wrappers are unwrapped. Keys are written in UTF-8 byte order. Proxies of these (Vue and MobX reactive state, reactive `Map`s included) encode like their targets |
| `SharedArrayBuffer` | Binary. `decode` accepts input in shared memory too, and copies it first |
| `Ext(type, data)` | Any other extension type; `data` is a `Uint8Array`. Types -1 to -6 and -10 are BTOON's own, written from the types above: encoding them as an `Ext` throws `invalid_argument` |

Functions and symbols throw `BtoonError` with `code: 'invalid_argument'`. Cycles throw
`code: 'max_depth'`. A decoded key named `"__proto__"` becomes an ordinary own property and
never touches the prototype.

`BtoonDate` and `BtoonDateTime` (spec 0.3) are the typed values for BTOON's date and datetime
extensions, which JavaScript has no types for. Both are `Timestamp` subclasses holding the
exact value on the wire, `epochMilliseconds` or `epochNanoseconds` as a `bigint`:

```js
const { BtoonDate, BtoonDateTime, Timestamp, decode, encode } = require('btoon');

encode(new BtoonDate(1700000000123n));               // <Buffer d7 fe 00 00 01 8b cf e5 68 7b>
const at = decode(encode(new BtoonDateTime(-1n)), { timestamps: 'object' });
at instanceof Timestamp;                             // true: seconds -1n, nanoseconds 999999999
BtoonDate.fromDate(new Date());                      // also fromTimestamp(ts) and toDate()
```

With `timestamps: 'object'`, decoding returns `Timestamp`, `BtoonDate` and `BtoonDateTime`
values that encode back to the same bytes. The constructors take a `bigint`, or a
safe-integer `number`, in the int64 range. `fromTimestamp` floors to the millisecond for a
date, is exact for a datetime, and refuses a `Timestamp` with a UTC offset.

## Options

```ts
encode(value, { compress?, compression?: 'zlib'|'lz4'|'zstd'|'brotli'|'snappy', autoTabular?, maxDepth?, hmacKey? })
decode(bytes, { strict?, maxDepth?, maxDecompressedSize?, maxValues?, autoDecompress?, hmacKey?, timestamps?: 'date'|'object', bigint?: 'auto'|'always' })
compressionAvailable('zstd')   // the prebuilt binaries include zlib only
```

Options are checked as in `@btoon/js`: booleans must be booleans, limits non-negative safe
integers, and anything else throws `invalid_argument`; `null` options mean the defaults.
`maxDepth` defaults to 128 and can't exceed 1000. Only an absent `hmacKey` (`undefined`)
means no key: an empty key or `null` throws `invalid_argument` instead of turning signing or
verification off. `bigint: 'always'` gives a `bigint` for every integer outside
[-2^31, 2^32-1], the range a canonical encoder writes without a 64-bit marker (0.2 gave one for
every integer). `compression: 'auto'` is a deprecated alias for `'zlib'`: it still works, and
warns once (`DeprecationWarning`, code `BTOON_DEP_AUTO`).

## Untrusted input

`decode` is safe on hostile bytes:
- reads are bounds-checked and nesting depth is limited;
- it never allocates more than the input justifies;
- strict mode (the default) rejects invalid UTF-8, duplicate keys and trailing data. Keys
  and column names must be valid UTF-8 in non-strict mode too.

Two limits bound the memory a document can claim (spec §7.1):
- `maxDecompressedSize` (64 MiB by default) caps what a compression envelope expands to,
  and the column-name bytes a table copies into its rows (rows × total name length);
- `maxValues` (2^20 = 1,048,576 by default) caps how many values a document decodes to.
  The top-level value, every array element and object value, and every table row and cell
  count once. Keys don't count.

Going over either throws `size_limit`. Raise them to decode bigger documents, and keep the
defaults (or lower them) for untrusted input.

Every failure throws `BtoonError`, and `err.code` is a spec error code: `truncated`,
`max_depth`, `invalid_utf8`, `size_limit`, `authentication_failed`, and so on.

## Same as @btoon/js

Both packages implement the same API with the same behavior, and `@btoon/js` is the
reference: the same values encode to the same bytes, decode to the same values, and fail
with the same error codes (and, for values and options they refuse, the same messages; the
decoders' messages differ). That includes how they call your code: getters,
`toJSON()` and Proxy traps run in the same order and the same number of times. The test
suite checks this with cases shared by the two repositories (`test/parity-cases.cjs`), and
against `@btoon/js` itself when it's available. The classes carry the same brands, so
`instanceof` recognizes values from either package, and either encoder accepts them.

The deliberate differences:
- `encode` returns a `Buffer`, and binaries and `Ext` data decode to `Buffer`s (`@btoon/js`
  returns plain `Uint8Array`s; a `Buffer` is one).
- `compressionAvailable()` is extra, and so is the deprecated `version()`.
- `compression: 'auto'` is accepted, as a deprecated alias for `'zlib'` kept from 0.2 (with a
  one-time `DeprecationWarning`, code `BTOON_DEP_AUTO`). `@btoon/js` refuses it.
- `options.codecs` is checked as in `@btoon/js`, but not used: this package compresses with
  the codecs built into it.
- A decoded map's keys come in UTF-8 byte order (core builds sorted maps), where `@btoon/js`
  keeps the order of the input. Canonical input has them in that order anyway.

## Performance

Size is where BTOON helps. For 10,000 records (`id`, `name`, `email`, `age`, `score`,
`active`) BTOON is **447 KB**, against 767 KB for MessagePack and 1,018 KB for JSON.

Speed is a different story. Measured on Node 22.22, Apple M4 Max, best of 15, same data
and byte-identical BTOON output:

| | encode | decode |
|---|---:|---:|
| `btoon` (this package, native) | 7.8 ms | 7.1 ms |
| [`@btoon/js`](https://github.com/BTOON-project/btoon-javascript) (pure TypeScript) | 1.1 ms | 1.6 ms |
| `@msgpack/msgpack` 3.1 (pure JS) | 2.7 ms | 2.5 ms |
| `JSON` | 1.5 ms | 1.9 ms |

This binding is the slowest of these. Each property access and object creation crosses
the Node-API boundary, while V8 optimizes pure JavaScript very well. For throughput, use
`@btoon/js`: same API, same bytes. This package is useful when you want the reference
C++ implementation itself.

## Interoperability

With `autoTabular: false` the output is canonical MessagePack, which `@msgpack/msgpack`
and every other MessagePack library read. MessagePack input with string keys decodes,
including timestamps. The same bytes decode identically in the
[Python](https://github.com/BTOON-project/btoon-python),
[browser](https://github.com/BTOON-project/btoon-javascript),
[Go](https://github.com/BTOON-project/btoon-go) and
[PHP](https://github.com/BTOON-project/btoon-php) libraries.

## Development

```bash
git clone --recursive https://github.com/BTOON-project/btoon-nodejs && cd btoon-nodejs
npm install && npm run build && npm test
```

The build compiles the core sources the addon uses (`scripts/core-path.js` lists them)
straight into the addon, with no separate library and no OpenSSL. If `core/` is empty, it
falls back to `../btoon-core` or `BTOON_CORE_DIR`. `npm test` runs the conformance vectors,
the API and parity tests, and the type test. To also compare with `@btoon/js` side by side,
point `BTOON_JS` at a built `@btoon/js` package directory.

## License

MIT
