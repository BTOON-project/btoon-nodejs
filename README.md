# btoon for Node.js

Native Node.js bindings for **BTOON**, a compact binary serialization format: **MessagePack
plus a columnar encoding for arrays of uniform objects**, with timestamps, bigints, float
vectors and optional compression/signing. Built on the C++ reference implementation
([btoon-core](https://github.com/BTOON-project/btoon-core)), BTOON spec 0.2. The API is the
same as [`@btoon/js`](https://github.com/BTOON-project/btoon-javascript), the pure
JavaScript implementation.

> **Most applications should use [`@btoon/js`](https://www.npmjs.com/package/@btoon/js)
> instead.** It has the same API and writes the same bytes, and in Node.js it is 4–7×
> faster than this addon (see [Performance](#performance)). Use this package when you
> want the C++ reference implementation itself, or a source build with Zstd, LZ4, Brotli
> or Snappy.

```bash
npm install btoon
```

Prebuilt binaries (Node-API, Node ≥ 18) ship for Linux x64 (glibc and musl), Linux arm64 (glibc), macOS
arm64/x64 and Windows x64. The glibc ones need glibc 2.28 or newer, like Node.js's own Linux builds:
RHEL 8, Debian 10, Ubuntu 20.04 and Amazon Linux 2023 (AWS Lambda's `nodejs20.x` and later) all qualify.
On other platforms npm builds from source, which needs a C++20 compiler and Python for node-gyp.

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
| `bigint` | Uses 64-bit ints when it fits, the bigint extension otherwise. Decodes to `bigint` beyond `Number.MAX_SAFE_INTEGER` (or always, with `bigint: 'always'`). |
| `Buffer`, `Uint8Array`, other typed arrays, `ArrayBuffer`, `DataView` → `Buffer` | |
| `Float32Array`, `Float64Array` | Packed float vectors (little-endian); embeddings take 4 bytes per value |
| `Date` → `Date` | `Timestamp` keeps nanoseconds and a UTC offset (`timestamps: 'object'`). Instants outside the range of `Date` decode as `Timestamp` |
| arrays, plain objects, `Map` (string keys), class instances | Like `JSON.stringify`: own enumerable properties, and `toJSON()` is honored. Keys are written in UTF-8 byte order. Proxies of these (Vue and MobX reactive state) encode like their targets |
| `Ext(type, data)` | Any other extension type. Types -1 to -6 and -10 are BTOON's own, written from the types above: encoding them as an `Ext` throws `invalid_argument` |

Functions and symbols throw `BtoonError` with `code: 'invalid_argument'`. Cycles throw
`code: 'max_depth'`. A decoded key named `"__proto__"` becomes an ordinary own property and
never touches the prototype.

## Options

```ts
encode(value, { compress?, compression?: 'zlib'|'lz4'|'zstd'|'brotli'|'snappy', autoTabular?, maxDepth?, hmacKey? })
decode(bytes, { strict?, maxDepth?, maxDecompressedSize?, maxValues?, autoDecompress?, hmacKey?, timestamps?: 'date'|'object', bigint?: 'auto'|'always' })
compressionAvailable('zstd')   // the prebuilt binaries include zlib only
```

`maxDepth` defaults to 128 and can't exceed 1000. Only an absent `hmacKey` (`undefined`)
means no key: an empty key or `null` throws `invalid_argument` instead of turning signing or
verification off.

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
C++ implementation itself, or Zstd/LZ4/Brotli/Snappy envelopes from a build that
includes them.

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

The build compiles `core/src/*.cpp` straight into the addon, with no separate library and
no OpenSSL. If `core/` is empty, it falls back to `../btoon-core` or `BTOON_CORE_DIR`.

## License

MIT
