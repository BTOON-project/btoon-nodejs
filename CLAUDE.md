# btoon-nodejs

Node-API addon (node-addon-api) wrapping btoon-core. npm package `btoon`, BTOON spec 0.1.
The API mirrors `@btoon/js` (btoon-javascript), so keep the two in sync.

## Commands

```bash
npm install --ignore-scripts && npx node-gyp rebuild && npm test   # node --test on test/api.test.js and test/vectors.test.js
npm run examples
```

- **This workspace sits on an SMB share.** `node_modules/.bin` symlinks fail there
  (`EINVAL`), so `npx prebuildify` and similar tools can't run. Run them from a copy on
  local disk.
- Core sources come from `core/` (git submodule), falling back to `../btoon-core` or
  `BTOON_CORE_DIR`. `scripts/core-path.js` feeds binding.gyp.
- Don't add node-addon-api's `node_addon_api_except` gyp dependency back. It forces
  `MACOSX_DEPLOYMENT_TARGET=10.7`, which modern libc++ rejects.

## Layout

- `src/btoon_node.cpp`:
  - Encode: JS → `btoon::Encoder` directly. `JsEncoder` uses the tabular API plus
    `tabular_beneficial`.
  - Decode: core `decode()` → `btoon::Value` → JS.
  - `decodeAsync` parses on the thread pool. `encodeAsync` builds envelopes there.
- `index.js` holds the JS classes (`BtoonError`, `Ext`, `Timestamp`, passed to
  `native.setup`) and option normalization. `index.mjs` is the ESM wrapper and
  `index.d.ts` the types.
- `test/vectors.test.js` runs the shared conformance vectors. `test/api.test.js` covers
  JS mappings, policies and fuzzing.

## Policies (shared with @btoon/js)

- `-0` encodes as float.
- Safe integers become ints, everything else float64.
- Class instances follow `JSON.stringify` (`toJSON`, own enumerable props).
- `"__proto__"` becomes an own property.
- An empty `hmacKey`, or a string one with a lone surrogate, is `invalid_argument`
  (UTF-8 would make it U+FFFD, a key collision). `null` still means no key until D25.
- A string with a lone surrogate is `invalid_utf8` (napi would silently write U+FFFD).
- A Proxy encodes like its target. `napi_get_prototype` reports null for every Proxy, so a
  null prototype is classified in JS (`proxyKind` in index.js: `Array.isArray`,
  `Object.getPrototypeOf`).
- With `timestamps: 'date'`, an instant outside Date's range (±8.64e15 ms) decodes to a
  `Timestamp`, never `Invalid Date`.
- `Timestamp` and `Ext` fields out of range are `invalid_argument`, in the constructors and
  again in `encode` (the fields are writable). Never let a napi conversion wrap.
- Linux glibc prebuilds are built in manylinux_2_28 (`scripts/prebuild-linux.sh`) and must
  need at most GLIBC 2.28 / GLIBCXX 3.4.25 (`scripts/check-glibc.sh`).

Known: the native path is 2.5–3.5× slower than pure-JS MessagePack libraries (Node-API
call overhead). See the README Performance section.
