'use strict';
// Compression envelopes, HMAC signing and safe decoding of untrusted input.
const btoon = require('..');

const rows = Array.from({ length: 5000 }, (_, i) => ({ event: 'click', user: `u${i % 50}`, ms: 1700000000000 + i }));
const plain = btoon.encode(rows);
const packed = btoon.encode(rows, { compress: true }); // zlib by default
console.log(`plain ${plain.length} B -> zlib ${packed.length} B`);

const key = 'use 32+ random bytes as the key!';
const sealed = btoon.encode(rows, { compress: true, hmacKey: key });
console.log('verified rows:', btoon.decode(sealed, { hmacKey: key }).length);

const tampered = Buffer.from(sealed);
tampered[tampered.length - 1] ^= 1;
try {
  btoon.decode(tampered, { hmacKey: key });
} catch (err) {
  console.log('rejected:', err.code); // authentication_failed
}

try {
  btoon.decode(Buffer.concat([Buffer.alloc(10000, 0x91), Buffer.from([0xc0])])); // absurdly deep
} catch (err) {
  console.log('rejected:', err.code); // max_depth
}
