# btoon for Node.js

Native Node.js bindings for **BTOON**, a compact binary serialization format: **MessagePack
plus a columnar encoding for arrays of uniform objects**, with timestamps, bigints, float
vectors and optional compression/signing. Built on the C++ reference implementation
([btoon-core](https://github.com/BTOON-project/btoon-core)), BTOON spec 0.1. The API is the
same as [`@btoon/js`](https://github.com/BTOON-project/btoon-javascript), the pure
JavaScript implementation.

```bash
npm install btoon
```

Prebuilt binaries (Node-API, Node ≥ 18) ship for Linux x64/arm64 (glibc and musl), macOS
arm64/x64 and Windows x64. On other platforms npm builds from source, which needs a C++20
compiler and Python for node-gyp.

## Usage

```js
const btoon = require('btoon');            // or: import { encode, decode } from 'btoon'

const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i, name: `user${i}`, active: i % 2 === 0 }));

const bytes = btoon.encode(rows);           // Buffer; tables are stored column by column
btoon.decode(bytes);                        // deep-equals rows

btoon.encode(rows, { compress: true });     // zlib envelope, detected on decode
const sealed = btoon.encode(rows, { hmacKey: process.env.BTOON_KEY });
btoon.decode(sealed, { hmacKey: process.env.BTOON_KEY });

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
| `Date` → `Date` | `Timestamp` keeps nanoseconds and a UTC offset (`timestamps: 'object'`) |
| arrays, plain objects, `Map` (string keys), class instances | Like `JSON.stringify`: own enumerable properties, and `toJSON()` is honored. Keys are written in UTF-8 byte order. |
| `Ext(type, data)` | Any other extension type |

Functions and symbols throw `BtoonError` with `code: 'invalid_argument'`. Cycles throw
`code: 'max_depth'`. A decoded key named `"__proto__"` becomes an ordinary own property and
never touches the prototype.

## Options

```ts
encode(value, { compress?, compression?: 'zlib'|'lz4'|'zstd'|'brotli'|'snappy', autoTabular?, maxDepth?, hmacKey? })
decode(bytes, { strict?, maxDepth?, maxDecompressedSize?, autoDecompress?, hmacKey?, timestamps?: 'date'|'object', bigint?: 'auto'|'always' })
compressionAvailable('zstd')   // the prebuilt binaries include zlib only
```

## Untrusted input

`decode` is safe on hostile bytes:
- reads are bounds-checked and nesting depth is limited;
- it never allocates more than the input justifies, and decompression is capped
  (`maxDecompressedSize`, 256 MiB by default);
- strict mode (the default) rejects invalid UTF-8, duplicate keys and trailing data.

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
