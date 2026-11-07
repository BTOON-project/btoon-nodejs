'use strict';
// Arrays of objects with the same keys are stored column by column when that's smaller.
const btoon = require('..');

for (const n of [2, 8, 100, 10000]) {
  const rows = Array.from({ length: n }, (_, i) => ({ id: i, name: `user${i}`, active: i % 2 === 0 }));
  const tabular = btoon.encode(rows).length;
  const plain = btoon.encode(rows, { autoTabular: false }).length;
  console.log(`${String(n).padStart(5)} rows: tabular ${tabular} B vs plain ${plain} B (${Math.round((100 * tabular) / plain)}%)`);
}
