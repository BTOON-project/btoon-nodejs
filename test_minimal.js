// Minimal test to identify segfault
const btoon = require('./index');

console.log('Test 1: Simple object');
try {
    const data = { string: 'Hello', number: 42 };
    const encoded = btoon.encode(data);
    console.log('✓ Encoded successfully:', encoded.length, 'bytes');

    const decoded = btoon.decode(encoded);
    console.log('✓ Decoded successfully:', JSON.stringify(decoded));
} catch (err) {
    console.error('✗ Failed:', err.message);
    console.error(err.stack);
}

console.log('\nTest 2: Array');
try {
    const data = [1, 2, 3];
    const encoded = btoon.encode(data);
    console.log('✓ Encoded array:', encoded.length, 'bytes');

    const decoded = btoon.decode(encoded);
    console.log('✓ Decoded array:', JSON.stringify(decoded));
} catch (err) {
    console.error('✗ Failed:', err.message);
    console.error(err.stack);
}

console.log('\nTest 3: Nested object');
try {
    const data = { nested: { value: 'test' } };
    const encoded = btoon.encode(data);
    console.log('✓ Encoded nested:', encoded.length, 'bytes');

    const decoded = btoon.decode(encoded);
    console.log('✓ Decoded nested:', JSON.stringify(decoded));
} catch (err) {
    console.error('✗ Failed:', err.message);
    console.error(err.stack);
}

console.log('\nAll tests completed');
