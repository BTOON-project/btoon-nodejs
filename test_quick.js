// Quick test of BTOON Node.js library
const btoon = require('./index');

console.log('BTOON Node.js Library Test\n' + '='.repeat(40));

try {
    // Test 1: Basic encoding/decoding
    console.log('\n1. Basic encoding/decoding:');
    const basicData = {
        string: 'Hello BTOON',
        number: 42,
        float: 3.14159,
        boolean: true,
        null: null,
        array: [1, 2, 3],
        object: { nested: 'value' }
    };
    
    const encoded = btoon.encode(basicData);
    console.log(`   Encoded size: ${encoded.length} bytes`);
    
    const decoded = btoon.decode(encoded);
    console.log(`   Decoded successfully: ${JSON.stringify(decoded).substring(0, 50)}...`);
    
    // Test 2: Compression
    console.log('\n2. Compression test:');
    const largeData = { data: Array(1000).fill(0).map((_, i) => ({ id: i, value: Math.random() })) };
    const uncompressed = btoon.encode(largeData);
    const compressed = btoon.encode(largeData, true); // with compression
    console.log(`   Uncompressed: ${uncompressed.length} bytes`);
    console.log(`   Compressed: ${compressed.length} bytes`);
    console.log(`   Compression ratio: ${((1 - compressed.length/uncompressed.length) * 100).toFixed(1)}%`);
    
    // Test 3: Type preservation
    console.log('\n3. Type preservation:');
    const types = {
        int: 123,
        bigInt: 9007199254740992, // > MAX_SAFE_INTEGER
        float: 3.14,
        binary: Buffer.from([0xFF, 0xFE, 0xFD])
    };
    
    const typesEncoded = btoon.encode(types);
    const typesDecoded = btoon.decode(typesEncoded);
    console.log(`   Integer: ${typesDecoded.int} (${typeof typesDecoded.int})`);
    console.log(`   Big int: ${typesDecoded.bigInt}`);
    console.log(`   Float: ${typesDecoded.float}`);
    console.log(`   Binary: Buffer of length ${typesDecoded.binary.length}`);
    
    console.log('\n✅ All tests passed!');
    
} catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
}
