# Examples

```bash
npm install && npm run examples
```

| File | Shows |
|---|---|
| `01-basic.js` | Type mapping: Date, bigint, Buffer, Float32Array, Map; size vs JSON |
| `02-compression.js` | zlib envelope, HMAC signing, tamper detection, depth limit |
| `03-tabular.js` | When the columnar encoding kicks in, and what it saves |
| `04-streaming.js` | Framed values plus `decodeAsync` on the thread pool |
