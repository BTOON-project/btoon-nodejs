# BTOON Node.js Examples

This directory contains practical examples of using BTOON in Node.js applications.

## Running the Examples

First, ensure you have built and installed the BTOON module:

```bash
cd ..
npm install
npm run build
```

Then run any example:

```bash
node 01-basic.js
node 02-compression.js
node 03-tabular.js
node 04-streaming.js
```

## Examples Overview

### 01-basic.js
Basic encoding and decoding operations:
- Simple data types (strings, numbers, booleans, null)
- Nested objects and arrays
- Binary data (Buffers)
- Type preservation

### 02-compression.js
Compression features and optimization:
- Different compression ratios for various data sizes
- Compression effectiveness by data type
- Performance comparison
- Decompression and data integrity

### 03-tabular.js
Tabular/columnar data optimization:
- Encoding database-like records
- Columnar vs row-based encoding comparison
- Performance with different record counts
- Combined tabular + compression

### 04-streaming.js
Streaming operations for large datasets:
- Transform streams for encoding/decoding
- File-based streaming
- Batched processing
- Memory-efficient data handling

## Key Features Demonstrated

- **Performance**: BTOON is typically 5-10x faster than JSON
- **Size**: 40-60% smaller than JSON without compression
- **Compression**: Additional 50-80% size reduction with compression
- **Tabular Data**: 30-50% better compression for structured records
- **Streaming**: Process large datasets without loading into memory
- **Type Safety**: Preserves JavaScript types accurately

## Use Cases

1. **API Communication**: Replace JSON for faster, smaller payloads
2. **Data Storage**: Efficient file storage with compression
3. **Real-time Systems**: Low-latency encoding for streaming data
4. **Analytics**: Columnar encoding for time-series and metrics
5. **Caching**: Reduced memory usage in Redis/Memcached

## Performance Tips

1. Use tabular encoding for arrays of similar objects
2. Enable compression for data > 1KB
3. Use streaming for large datasets
4. Batch small messages for network transmission
5. Reuse encoder/decoder instances when possible

## Next Steps

- See the [API documentation](../README.md) for detailed reference
- Check [TypeScript definitions](../index.d.ts) for type safety
- Run [benchmarks](../test/benchmark.js) for performance analysis
