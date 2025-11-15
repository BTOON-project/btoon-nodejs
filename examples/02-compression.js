#!/usr/bin/env node
/**
 * BTOON compression examples
 */

const btoon = require('../index');
const fs = require('fs');

console.log('BTOON Compression Example\n' + '='.repeat(40));

// Generate sample data with repetition (good for compression)
function generateSampleData(count) {
    const data = [];
    const templates = ['Alice', 'Bob', 'Charlie', 'David', 'Eve'];
    const departments = ['Engineering', 'Sales', 'Marketing', 'HR', 'Finance'];
    
    for (let i = 0; i < count; i++) {
        data.push({
            id: i,
            name: templates[i % templates.length],
            email: `user${i}@example.com`,
            department: departments[i % departments.length],
            score: Math.floor(Math.random() * 100),
            active: i % 2 === 0,
            tags: ['user', 'employee', 'active'],
            metadata: {
                created: '2024-01-01T00:00:00Z',
                updated: '2024-01-01T00:00:00Z',
                version: 1
            }
        });
    }
    return data;
}

// Test different compression scenarios
console.log('\n1. Small data compression:');
const smallData = generateSampleData(10);
const smallUncompressed = btoon.encode(smallData);
const smallCompressed = btoon.encode(smallData, { compress: true });

console.log('Uncompressed:', smallUncompressed.length, 'bytes');
console.log('Compressed:', smallCompressed.length, 'bytes');
console.log('Ratio:', ((1 - smallCompressed.length / smallUncompressed.length) * 100).toFixed(1) + '%');
console.log('Note: Small data may not compress well or may even increase in size');

console.log('\n2. Medium data compression:');
const mediumData = generateSampleData(100);
const mediumUncompressed = btoon.encode(mediumData);
const mediumCompressed = btoon.encode(mediumData, { compress: true });

console.log('Uncompressed:', mediumUncompressed.length, 'bytes');
console.log('Compressed:', mediumCompressed.length, 'bytes');
console.log('Ratio:', ((1 - mediumCompressed.length / mediumUncompressed.length) * 100).toFixed(1) + '%');

console.log('\n3. Large data compression:');
const largeData = generateSampleData(1000);
const largeUncompressed = btoon.encode(largeData);
const largeCompressed = btoon.encode(largeData, { compress: true });

console.log('Uncompressed:', largeUncompressed.length, 'bytes');
console.log('Compressed:', largeCompressed.length, 'bytes');
console.log('Ratio:', ((1 - largeCompressed.length / largeUncompressed.length) * 100).toFixed(1) + '%');

// Test compression with different data types
console.log('\n4. Compression by data type:');

// Highly repetitive strings
const repetitiveData = {
    logs: Array(100).fill('ERROR: Connection timeout').map((msg, i) => ({
        timestamp: i,
        message: msg,
        level: 'ERROR'
    }))
};
const repUncomp = btoon.encode(repetitiveData);
const repComp = btoon.encode(repetitiveData, { compress: true });
console.log('Repetitive strings - Uncompressed:', repUncomp.length, 'Compressed:', repComp.length, 
    'Ratio:', ((1 - repComp.length / repUncomp.length) * 100).toFixed(1) + '%');

// Random numbers (poor compression)
const randomData = {
    values: Array(1000).fill(0).map(() => Math.random())
};
const randUncomp = btoon.encode(randomData);
const randComp = btoon.encode(randomData, { compress: true });
console.log('Random numbers - Uncompressed:', randUncomp.length, 'Compressed:', randComp.length,
    'Ratio:', ((1 - randComp.length / randUncomp.length) * 100).toFixed(1) + '%');

// Sequential data (good compression)
const sequentialData = {
    sequence: Array(1000).fill(0).map((_, i) => i),
    constant: Array(1000).fill(42)
};
const seqUncomp = btoon.encode(sequentialData);
const seqComp = btoon.encode(sequentialData, { compress: true });
console.log('Sequential data - Uncompressed:', seqUncomp.length, 'Compressed:', seqComp.length,
    'Ratio:', ((1 - seqComp.length / seqUncomp.length) * 100).toFixed(1) + '%');

// Test decompression
console.log('\n5. Decompression test:');
const testData = { test: 'compression', array: [1, 2, 3, 4, 5], nested: { key: 'value' } };
const compressed = btoon.encode(testData, { compress: true });
const decompressed = btoon.decode(compressed, { decompress: true });
console.log('Original:', testData);
console.log('After compress/decompress:', decompressed);
console.log('Data integrity:', JSON.stringify(testData) === JSON.stringify(decompressed) ? '✅ OK' : '❌ FAILED');

console.log('\n✅ All compression examples completed successfully!');
