#!/usr/bin/env node
/**
 * BTOON tabular data optimization example
 */

const btoon = require('../index');

console.log('BTOON Tabular Data Example\n' + '='.repeat(40));

// Generate tabular data (like database records)
function generateEmployeeRecords(count) {
    const departments = ['Engineering', 'Sales', 'Marketing', 'HR', 'Finance'];
    const positions = ['Manager', 'Senior', 'Junior', 'Lead', 'Intern'];
    const locations = ['New York', 'San Francisco', 'London', 'Tokyo', 'Berlin'];
    
    const records = [];
    for (let i = 0; i < count; i++) {
        records.push({
            id: 1000 + i,
            firstName: `First${i}`,
            lastName: `Last${i}`,
            email: `employee${i}@company.com`,
            department: departments[i % departments.length],
            position: positions[i % positions.length],
            location: locations[i % locations.length],
            salary: 50000 + Math.floor(Math.random() * 100000),
            startDate: '2020-01-01',
            isActive: true,
            performanceScore: parseFloat((Math.random() * 5).toFixed(2))
        });
    }
    return records;
}

console.log('\n1. Tabular encoding comparison:');
const records = generateEmployeeRecords(100);

// Regular encoding
const regularEncoded = btoon.encode(records, { autoTabular: false });
console.log('Regular encoding:', regularEncoded.length, 'bytes');

// Tabular encoding (columnar format)
const tabularEncoded = btoon.encode(records, { autoTabular: true });
console.log('Tabular encoding:', tabularEncoded.length, 'bytes');
console.log('Size reduction:', 
    ((1 - tabularEncoded.length / regularEncoded.length) * 100).toFixed(1) + '%');

// Verify data integrity
const decoded = btoon.decode(tabularEncoded);
console.log('Records preserved:', decoded.length === records.length ? '✅' : '❌');
console.log('First record matches:', 
    JSON.stringify(decoded[0]) === JSON.stringify(records[0]) ? '✅' : '❌');

console.log('\n2. Different record counts:');
const sizes = [10, 50, 100, 500, 1000];
sizes.forEach(size => {
    const data = generateEmployeeRecords(size);
    const regular = btoon.encode(data, { autoTabular: false });
    const tabular = btoon.encode(data, { autoTabular: true });
    const improvement = ((1 - tabular.length / regular.length) * 100).toFixed(1);
    console.log(`${size} records: Regular=${regular.length}B, Tabular=${tabular.length}B, Improvement=${improvement}%`);
});

console.log('\n3. Mixed columnar data:');
// Some columns with high cardinality, some with low
const mixedData = Array(100).fill(0).map((_, i) => ({
    // Low cardinality (good for columnar)
    status: i < 30 ? 'pending' : i < 60 ? 'processing' : 'completed',
    priority: i % 3 === 0 ? 'high' : i % 3 === 1 ? 'medium' : 'low',
    category: i % 5,
    
    // High cardinality (less benefit from columnar)
    uuid: `uuid-${Math.random().toString(36).substring(2, 15)}`,
    timestamp: Date.now() + i * 1000,
    randomValue: Math.random(),
    
    // Repeated structure
    metadata: {
        version: 1,
        format: 'standard',
        source: 'api'
    }
}));

const mixedRegular = btoon.encode(mixedData, { autoTabular: false });
const mixedTabular = btoon.encode(mixedData, { autoTabular: true });
console.log('Mixed data - Regular:', mixedRegular.length, 'bytes');
console.log('Mixed data - Tabular:', mixedTabular.length, 'bytes');
console.log('Improvement:', ((1 - mixedTabular.length / mixedRegular.length) * 100).toFixed(1) + '%');

console.log('\n4. Tabular with compression:');
const largeRecords = generateEmployeeRecords(1000);

const normalSize = btoon.encode(largeRecords, { 
    autoTabular: false, 
    compress: false 
}).length;

const tabularSize = btoon.encode(largeRecords, { 
    autoTabular: true, 
    compress: false 
}).length;

const compressedSize = btoon.encode(largeRecords, { 
    autoTabular: false, 
    compress: true 
}).length;

const tabularCompressedSize = btoon.encode(largeRecords, { 
    autoTabular: true, 
    compress: true 
}).length;

console.log('Normal encoding:', normalSize, 'bytes');
console.log('Tabular encoding:', tabularSize, 'bytes', 
    `(${((1 - tabularSize/normalSize) * 100).toFixed(1)}% smaller)`);
console.log('Compressed encoding:', compressedSize, 'bytes',
    `(${((1 - compressedSize/normalSize) * 100).toFixed(1)}% smaller)`);
console.log('Tabular + Compressed:', tabularCompressedSize, 'bytes',
    `(${((1 - tabularCompressedSize/normalSize) * 100).toFixed(1)}% smaller)`);

console.log('\n5. Performance comparison:');
const perfData = generateEmployeeRecords(10000);

console.time('JSON stringify');
const jsonStr = JSON.stringify(perfData);
console.timeEnd('JSON stringify');

console.time('BTOON encode (regular)');
const btoonRegular = btoon.encode(perfData, { autoTabular: false });
console.timeEnd('BTOON encode (regular)');

console.time('BTOON encode (tabular)');
const btoonTabular = btoon.encode(perfData, { autoTabular: true });
console.timeEnd('BTOON encode (tabular)');

console.log('\nSize comparison:');
console.log('JSON:', jsonStr.length, 'bytes');
console.log('BTOON regular:', btoonRegular.length, 'bytes');
console.log('BTOON tabular:', btoonTabular.length, 'bytes');

console.log('\n✅ All tabular examples completed successfully!');
