# btoon-nodejs

Node-API addon (node-addon-api) wrapping btoon-core. npm package `btoon`, BTOON spec 0.3.
The API and its behavior match `@btoon/js` (btoon-javascript), which is the reference: keep
the two in sync, and when they disagree, `@btoon/js` is right.

## Commands

```bash
npm install --ignore-scripts && npx node-gyp rebuild && npm test   # node --test: api, vectors, typed-dates, parity, types
BTOON_JS=../btoon-javascript npm test   # also compares with a built @btoon/js side by side (CI's `parity` job)
npm run examples
```

- **This workspace sits on an SMB share.** `node_modules/.bin` symlinks fail there
  (`EINVAL`), so `npx prebuildify` and similar tools can't run. Run them from a copy on
  local disk.
- Core sources come from `core/` (git submodule), falling back to `../btoon-core` or
  `BTOON_CORE_DIR`. `scripts/core-path.js` feeds binding.gyp, and lists the only core sources
  the addon is built from; `package.json` `files` ships exactly those (a test checks).
- Don't add node-addon-api's `node_addon_api_except` gyp dependency back. It forces
  `MACOSX_DEPLOYMENT_TARGET=10.7`, which modern libc++ rejects.
- CI builds with `CXXFLAGS=-ftrivial-auto-var-init=pattern`. For ASan on macOS, build with
  `-fsanitize=address,undefined` and run each test file with `node test/<file>` and
  `DYLD_INSERT_LIBRARIES=$(clang -print-file-name=libclang_rt.asan_osx_dynamic.dylib)`
  (`node --test` doesn't pass it on to its child processes).

## Layout

- `src/btoon_node.cpp`:
  - Encode: JS → `btoon::Encoder` directly. `JsEncoder` is a port of @btoon/js's encoder
    (`encode.ts`): same classification, same order of user code (getters, `toJSON()`, Proxy
    traps), same errors. It settles arrays, plain objects, typed arrays, ArrayBuffers and
    Dates itself and asks index.js's `classify()` about every other object. The kinds are
    @btoon/js's `K_*` numbers. Tables use core's tabular API plus `tabular_beneficial`.
  - Decode: core `decode()` → `btoon::Value` → JS.
  - `decodeAsync` parses on the thread pool. `encodeAsync` builds envelopes there.
- `index.js` holds the JS classes (`BtoonError`, `Ext`, `Timestamp`, `BtoonDate`,
  `BtoonDateTime`), the option checks, and the encoder's helpers (`classify`, `unbox`,
  `mapKeys`, `mapGet`, `bytesOf`), all ported from @btoon/js (`values.ts`, `options.ts`,
  `encode.ts`) and passed to `native.setup`. `index.mjs` is the ESM wrapper and `index.d.ts`
  the types (its `VERSION`/`SPEC_VERSION` literals change with each release).
- Tests: `test/vectors.test.js` runs the conformance vectors; `test/api.test.js` covers JS
  mappings, policies, workers and fuzzing; `test/typed-dates.test.js` is @btoon/js's
  typed-date test; `test/parity-cases.cjs` is a copy of btoon-javascript's (keep them
  identical) and `test/parity.test.js` runs it, plus side-by-side runs with `BTOON_JS`;
  `test/types.test.js` compiles `test/types/consumer.ts`.

## Policies (shared with @btoon/js)

- `-0` encodes as float.
- Safe integers become ints, everything else float64. On decode, `bigint: 'always'` gives a
  bigint outside [-2^31, 2^32-1]; the type depends on the value, not the encoding.
- Class instances follow `JSON.stringify` (`toJSON`, own enumerable props). A plain object's
  own `toJSON` is called too (an inherited one isn't). `toJSON()` runs once per value and
  adds no depth. Wrapper objects are unwrapped.
- Maps are read with the intrinsic `Map` methods; a Proxy of one through its own `keys()`
  and `get()`, and a repeated key is `invalid_argument`.
- `"__proto__"` becomes an own property.
- An empty or `null` `hmacKey`, or a string one with a lone surrogate, is
  `invalid_argument` (UTF-8 would make a lone surrogate U+FFFD, a key collision). Only
  `undefined` means no key (spec §8, D25).
- Input in a `SharedArrayBuffer` is copied once (index.js) before it is verified and parsed:
  another thread could change it in between.
- A string with a lone surrogate is `invalid_utf8` (napi would silently write U+FFFD).
- A Proxy encodes like its target. `napi_get_prototype` reports null for every Proxy, so a
  null prototype is classified in JS (`classify` in index.js: `Array.isArray`,
  `Object.getPrototypeOf`).
- With `timestamps: 'object'`, -1/-2/-3 decode to `Timestamp`/`BtoonDate`/`BtoonDateTime`.
  With `'date'`, an instant outside Date's range (±8.64e15 ms) decodes to a `Timestamp` (a
  `BtoonDate` for a date), never `Invalid Date`.
- `Timestamp`, `BtoonDate`, `BtoonDateTime` and `Ext` fields out of range are
  `invalid_argument`, in the constructors and again in `encode` (the fields are writable).
  Never let a napi conversion wrap. The classes' brands (`Symbol.for('btoon.…')`) are
  @btoon/js's, and `instanceof` checks them.
- Options are checked exactly as in @btoon/js, with its messages. `codecs` is checked but
  not used. One exception: `compression: 'auto'` (from 0.2) is a deprecated alias for
  `'zlib'` with a one-time `DeprecationWarning` (`BTOON_DEP_AUTO`); @btoon/js refuses it, so it
  isn't in the shared parity cases.
- Linux glibc prebuilds are built in manylinux_2_28 (`scripts/prebuild-linux.sh`) and must
  need at most GLIBC 2.28 / GLIBCXX 3.4.25 (`scripts/check-glibc.sh`).

Known: the native path is 2.5–3.5× slower than pure-JS MessagePack libraries (Node-API
call overhead). See the README Performance section.
