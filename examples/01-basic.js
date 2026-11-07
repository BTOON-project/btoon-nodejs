'use strict';
// Encode and decode common JavaScript values.
const btoon = require('..');

const doc = {
  name: 'Ada',
  joined: new Date('2024-01-01T09:30:00Z'),
  big: 2n ** 80n,
  scores: [9.5, 7.25, 10],
  avatar: Buffer.from('89504e47', 'hex'),
  embedding: new Float32Array([0.12, -0.5, 0.33]),
  tags: new Map([['role', 'admin']]),
};

const bytes = btoon.encode(doc);
const back = btoon.decode(bytes);
console.log(`${bytes.length} bytes`, back);

const rows = Array.from({ length: 500 }, (_, i) => ({ id: i, city: 'Tallinn', temp: 20 + i / 10 }));
console.log(`500 rows: BTOON ${btoon.encode(rows).length} B, ` +
  `MessagePack-style ${btoon.encode(rows, { autoTabular: false }).length} B, JSON ${JSON.stringify(rows).length} B`);
