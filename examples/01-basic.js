#!/usr/bin/env node
/**
 * Basic BTOON encoding and decoding example
 */

const btoon = require('../index');

console.log('BTOON Basic Example\n' + '='.repeat(40));

// Simple data types
const simpleData = {
    message: 'Hello, BTOON!',
    count: 42,
    pi: 3.14159,
    active: true,
    empty: null
};

console.log('\n1. Simple data encoding:');
console.log('Original:', simpleData);

const encoded = btoon.encode(simpleData);
console.log('Encoded size:', encoded.length, 'bytes');
console.log('Encoded (hex):', encoded.toString('hex').substring(0, 50) + '...');

const decoded = btoon.decode(encoded);
console.log('Decoded:', decoded);

// Nested structures
const nestedData = {
    user: {
        id: 1001,
        name: 'Alice',
        email: 'alice@example.com',
        roles: ['admin', 'user'],
        settings: {
            theme: 'dark',
            notifications: true,
            language: 'en'
        }
    },
    metadata: {
        created: new Date().toISOString(),
        version: '0.0.1'
    }
};

console.log('\n2. Nested structure encoding:');
const nestedEncoded = btoon.encode(nestedData);
console.log('Original size (JSON):', JSON.stringify(nestedData).length, 'bytes');
console.log('BTOON size:', nestedEncoded.length, 'bytes');
console.log('Size reduction:', 
    Math.round((1 - nestedEncoded.length / JSON.stringify(nestedData).length) * 100) + '%');

// Arrays of different types
const arrayData = {
    numbers: [1, 2, 3, 4, 5],
    strings: ['apple', 'banana', 'cherry'],
    mixed: [42, 'hello', true, null, { key: 'value' }],
    matrix: [[1, 2], [3, 4], [5, 6]]
};

console.log('\n3. Array encoding:');
const arrayEncoded = btoon.encode(arrayData);
const arrayDecoded = btoon.decode(arrayEncoded);
console.log('Numbers preserved:', JSON.stringify(arrayDecoded.numbers));
console.log('Strings preserved:', JSON.stringify(arrayDecoded.strings));
console.log('Mixed types preserved:', JSON.stringify(arrayDecoded.mixed));
console.log('Matrix preserved:', JSON.stringify(arrayDecoded.matrix));

// Binary data
const binaryData = {
    id: 'file-001',
    content: Buffer.from('Binary content here', 'utf8'),
    checksum: Buffer.from([0xDE, 0xAD, 0xBE, 0xEF])
};

console.log('\n4. Binary data encoding:');
const binaryEncoded = btoon.encode(binaryData);
const binaryDecoded = btoon.decode(binaryEncoded);
console.log('Content preserved:', binaryDecoded.content.toString('utf8'));
console.log('Checksum preserved:', Array.from(binaryDecoded.checksum).map(b => '0x' + b.toString(16).toUpperCase()).join(' '));

console.log('\n✅ All basic examples completed successfully!');
