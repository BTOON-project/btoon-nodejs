'use strict';
// Concatenated BTOON values in one buffer (e.g. a log file), decoded asynchronously
// on the thread pool so the event loop stays free.
const btoon = require('..');

async function main() {
  const events = Array.from({ length: 3 }, (_, i) => ({ seq: i, at: new Date(1700000000000 + i * 1000) }));
  const frames = events.map((e) => btoon.encode(e));
  // Length-prefix each frame so a reader can split the stream.
  const stream = Buffer.concat(frames.flatMap((f) => [Buffer.from(Uint32Array.of(f.length).buffer), f]));

  let offset = 0;
  while (offset < stream.length) {
    const len = stream.readUInt32LE(offset);
    const frame = stream.subarray(offset + 4, offset + 4 + len);
    console.log(await btoon.decodeAsync(frame));
    offset += 4 + len;
  }
}

main();
