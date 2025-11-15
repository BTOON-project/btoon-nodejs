#!/usr/bin/env node
/**
 * BTOON streaming example
 */

const btoon = require('../index');
const fs = require('fs');
const path = require('path');
const { Readable, Writable, Transform } = require('stream');

console.log('BTOON Streaming Example\n' + '='.repeat(40));

// Create sample data generator
function* dataGenerator(count) {
    for (let i = 0; i < count; i++) {
        yield {
            id: i,
            timestamp: new Date().toISOString(),
            event: `Event ${i}`,
            value: Math.random() * 100,
            metadata: {
                source: 'generator',
                sequence: i
            }
        };
    }
}

console.log('\n1. Basic streaming encode/decode:');

// Create a BTOON transform stream for encoding
class BTOONEncoder extends Transform {
    constructor(options) {
        super({ objectMode: true });
        this.options = options || {};
    }
    
    _transform(chunk, encoding, callback) {
        try {
            const encoded = btoon.encode(chunk, this.options);
            // Add a 4-byte length prefix for framing
            const lengthBuffer = Buffer.allocUnsafe(4);
            lengthBuffer.writeUInt32BE(encoded.length);
            this.push(Buffer.concat([lengthBuffer, encoded]));
            callback();
        } catch (err) {
            callback(err);
        }
    }
}

// Create a BTOON transform stream for decoding
class BTOONDecoder extends Transform {
    constructor(options) {
        super({ objectMode: true });
        this.options = options || {};
        this.buffer = Buffer.alloc(0);
    }
    
    _transform(chunk, encoding, callback) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        
        while (this.buffer.length >= 4) {
            const length = this.buffer.readUInt32BE(0);
            
            if (this.buffer.length >= 4 + length) {
                const data = this.buffer.slice(4, 4 + length);
                this.buffer = this.buffer.slice(4 + length);
                
                try {
                    const decoded = btoon.decode(data, this.options);
                    this.push(decoded);
                } catch (err) {
                    callback(err);
                    return;
                }
            } else {
                break;
            }
        }
        callback();
    }
}

// Test streaming
const encoder = new BTOONEncoder({ compress: false });
const decoder = new BTOONDecoder({ decompress: false });

let encodeCount = 0;
let decodeCount = 0;

// Create readable stream from generator
const readable = Readable.from(dataGenerator(10));

// Create writable stream to verify decoded data
const verifier = new Writable({
    objectMode: true,
    write(chunk, encoding, callback) {
        decodeCount++;
        console.log(`Decoded item ${decodeCount}:`, 
            JSON.stringify(chunk).substring(0, 50) + '...');
        callback();
    }
});

// Connect the pipeline
readable
    .on('data', () => encodeCount++)
    .pipe(encoder)
    .pipe(decoder)
    .pipe(verifier)
    .on('finish', () => {
        console.log(`\nEncoded ${encodeCount} items, decoded ${decodeCount} items`);
        console.log('Streaming integrity:', encodeCount === decodeCount ? '✅ OK' : '❌ FAILED');
        example2();
    });

// Example 2: File streaming
function example2() {
    console.log('\n2. File streaming example:');
    
    const filename = path.join(__dirname, 'stream-test.btoon');
    const testData = Array(100).fill(0).map((_, i) => ({
        record: i,
        data: `Record ${i}`,
        value: Math.random()
    }));
    
    // Write to file with streaming
    console.log('Writing 100 records to file...');
    const writeStream = fs.createWriteStream(filename);
    const fileEncoder = new BTOONEncoder();
    
    const source = Readable.from(testData);
    source
        .pipe(fileEncoder)
        .pipe(writeStream)
        .on('finish', () => {
            console.log('File written successfully');
            
            // Read from file with streaming
            console.log('Reading records from file...');
            const readStream = fs.createReadStream(filename);
            const fileDecoder = new BTOONDecoder();
            let readCount = 0;
            
            readStream
                .pipe(fileDecoder)
                .on('data', (obj) => {
                    readCount++;
                    if (readCount <= 3 || readCount > 97) {
                        console.log(`  Record ${obj.record}: ${obj.data}`);
                    } else if (readCount === 4) {
                        console.log('  ... (skipping middle records) ...');
                    }
                })
                .on('end', () => {
                    console.log(`Read ${readCount} records from file`);
                    
                    // Cleanup
                    fs.unlinkSync(filename);
                    console.log('Cleaned up test file');
                    example3();
                });
        });
}

// Example 3: Batched streaming
function example3() {
    console.log('\n3. Batched streaming:');
    
    class BatchedEncoder extends Transform {
        constructor(batchSize = 10) {
            super({ objectMode: true });
            this.batchSize = batchSize;
            this.batch = [];
        }
        
        _transform(chunk, encoding, callback) {
            this.batch.push(chunk);
            
            if (this.batch.length >= this.batchSize) {
                const encoded = btoon.encode(this.batch);
                this.push(encoded);
                this.batch = [];
            }
            callback();
        }
        
        _flush(callback) {
            if (this.batch.length > 0) {
                const encoded = btoon.encode(this.batch);
                this.push(encoded);
            }
            callback();
        }
    }
    
    const batchEncoder = new BatchedEncoder(5);
    const items = Array(23).fill(0).map((_, i) => ({ id: i, value: i * 10 }));
    let batchCount = 0;
    
    Readable.from(items)
        .pipe(batchEncoder)
        .on('data', (batch) => {
            batchCount++;
            const decoded = btoon.decode(batch);
            console.log(`Batch ${batchCount}: ${decoded.length} items, ` +
                       `IDs: ${decoded.map(d => d.id).join(', ')}`);
        })
        .on('end', () => {
            console.log(`\nProcessed ${items.length} items in ${batchCount} batches`);
            console.log('\n✅ All streaming examples completed successfully!');
        });
}
