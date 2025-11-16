// Debug test to see what's being encoded
const btoon = require('./index');

console.log('Testing encode output:');

const data1 = { string: 'Hello', number: 42 };
const encoded1 = btoon.encode(data1);
console.log('Data1:', data1);
console.log('Encoded1 length:', encoded1.length);
console.log('Encoded1 hex:', encoded1.toString('hex'));
console.log('Encoded1 bytes:', Array.from(encoded1));

console.log('\n---\n');

const data2 = [1, 2, 3];
const encoded2 = btoon.encode(data2);
console.log('Data2:', data2);
console.log('Encoded2 length:', encoded2.length);
console.log('Encoded2 hex:', encoded2.toString('hex'));

console.log('\n--- Try to decode ---\n');
try {
    const decoded = btoon.decode(encoded1);
    console.log('Decoded:', decoded);
} catch (err) {
    console.error('Decode error:', err);

    // Try decoding with C++ error details
    console.log('\nTrying decode with valid MessagePack:');
    // 0x82 = fixmap with 2 items
    const validMsgpack = Buffer.from([0x82, 0xa6, 0x73, 0x74, 0x72, 0x69, 0x6e, 0x67, 0xa5, 0x48, 0x65, 0x6c, 0x6c, 0x6f, 0xa6, 0x6e, 0x75, 0x6d, 0x62, 0x65, 0x72, 0x2a]);
    try {
        const decoded2 = btoon.decode(validMsgpack);
        console.log('Valid msgpack decoded:', decoded2);
    } catch (err2) {
        console.error('Still fails:', err2);
    }
}
