# BTOON for Node.js

[![npm version](https://img.shields.io/npm/v/btoon.svg)](https://www.npmjs.com/package/btoon)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

High-performance binary serialization format for Node.js applications.

## Features

- 🚀 **High Performance** - Native C++ implementation with Node.js bindings
- 📦 **Compact Binary Format** - Smaller than JSON, faster than MessagePack
- 🗜️ **Built-in Compression** - ZLIB, LZ4, ZSTD, Brotli, Snappy support
- 📊 **Tabular Data Optimization** - Columnar storage for structured data
- 🔄 **Schema Evolution** - Forward and backward compatibility
- ⚡ **Zero-Copy APIs** - Minimal memory overhead for large data
- 🛡️ **Type Safety** - Full TypeScript support included

## Installation

```bash
npm install btoon
```

Or using yarn:

```bash
yarn add btoon
```

## Quick Start

```javascript
const btoon = require('btoon');

// Encode data
const data = {
  name: 'BTOON',
  version: '0.0.1',
  features: ['fast', 'compact', 'typed'],
  metrics: {
    speed: 9000,
    size: 0.5
  }
};

const encoded = btoon.encode(data);
console.log('Encoded size:', encoded.length);

// Decode data
const decoded = btoon.decode(encoded);
console.log('Decoded:', decoded);
```

## Advanced Features

### Compression

```javascript
// Enable compression
const compressed = btoon.encode(data, {
  compress: true,
  algorithm: 'zstd',  // 'zlib', 'lz4', 'zstd', 'brotli', 'snappy'
  level: 3
});
```

### Tabular Data

```javascript
// Automatically detect and optimize tabular data
const records = [
  { id: 1, name: 'Alice', age: 30 },
  { id: 2, name: 'Bob', age: 25 },
  { id: 3, name: 'Charlie', age: 35 }
];

const tabular = btoon.encode(records, {
  autoTabular: true  // Automatically uses columnar encoding
});
```

### Streaming

```javascript
const { Readable } = require('stream');
const fs = require('fs');

// Stream encoding
const encoder = btoon.createEncoder();
const output = fs.createWriteStream('data.btoon');

encoder.pipe(output);
encoder.write({ chunk: 1 });
encoder.write({ chunk: 2 });
encoder.end();

// Stream decoding
const decoder = btoon.createDecoder();
const input = fs.createReadStream('data.btoon');

input.pipe(decoder);
decoder.on('data', (obj) => {
  console.log('Decoded object:', obj);
});
```

### TypeScript Support

```typescript
import * as btoon from 'btoon';

interface User {
  id: number;
  name: string;
  email: string;
}

const user: User = {
  id: 1,
  name: 'John Doe',
  email: 'john@example.com'
};

const encoded = btoon.encode<User>(user);
const decoded = btoon.decode<User>(encoded);
```

## Schema Support

```javascript
// Define schema
const schema = {
  type: 'object',
  properties: {
    id: { type: 'integer', required: true },
    name: { type: 'string', required: true },
    age: { type: 'integer', min: 0, max: 120 }
  }
};

// Validate and encode with schema
const validator = btoon.createValidator(schema);
if (validator.validate(data)) {
  const encoded = btoon.encode(data, { schema });
}
```

## API Reference

### Core Functions

#### `encode(data, options?)`
Encode JavaScript data to BTOON format.

**Parameters:**
- `data` - Any JavaScript value
- `options` (optional):
  - `compress`: boolean - Enable compression (default: false)
  - `algorithm`: string - Compression algorithm
  - `level`: number - Compression level (1-9)
  - `autoTabular`: boolean - Auto-detect tabular data
  - `schema`: object - Schema definition

**Returns:** Buffer

#### `decode(buffer, options?)`
Decode BTOON data to JavaScript values.

**Parameters:**
- `buffer` - Buffer containing BTOON data
- `options` (optional):
  - `decompress`: boolean - Enable decompression
  - `schema`: object - Expected schema

**Returns:** JavaScript value

### Streaming API

#### `createEncoder(options?)`
Create a transform stream for encoding.

#### `createDecoder(options?)`
Create a transform stream for decoding.

### Schema API

#### `createValidator(schema)`
Create a schema validator.

#### `validateSchema(schema)`
Validate a schema definition.

## Performance

BTOON provides significant performance improvements over JSON:

| Operation | JSON | BTOON | Improvement |
|-----------|------|--------|-------------|
| Encode 1MB | 45ms | 8ms | 5.6x faster |
| Decode 1MB | 38ms | 6ms | 6.3x faster |
| Size | 1024KB | 412KB | 60% smaller |

With compression:
- ZLIB: 75% size reduction
- LZ4: 65% reduction, 3x faster
- ZSTD: 80% reduction, balanced

## Examples

See the [`examples/`](examples/) directory for more usage examples:
- Basic encoding/decoding
- Tabular data handling
- Streaming operations
- Schema validation
- Compression benchmarks

## Requirements

- Node.js >= 18.0.0
- C++ compiler (for native modules)
- Python (for node-gyp)

## Building from Source

```bash
git clone https://github.com/BTOON-project/btoon-nodejs.git
cd btoon-nodejs
npm install
npm run build
npm test
```

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Links

- [Website](https://btoon.net)
- [GitHub](https://github.com/BTOON-project/btoon-nodejs)
- [Documentation](https://btoon.net/docs)
- [npm Package](https://www.npmjs.com/package/btoon)

---

Part of the BTOON project - High-performance binary serialization for modern applications.