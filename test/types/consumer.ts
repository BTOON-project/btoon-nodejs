// Compile-only: exercises index.d.ts the way a consumer would. Checked by test/types.test.js
// with `moduleResolution` NodeNext and Bundler, and without any `types` of the consumer's own:
// index.d.ts must bring the Node.js types it uses (Buffer) itself.
import btoon, {
  BtoonDate,
  BtoonDateTime,
  BtoonError,
  Ext,
  SPEC_VERSION,
  Timestamp,
  VERSION,
  compressionAvailable,
  decode,
  decodeAsync,
  encode,
  encodeAsync,
  version,
  type BinaryInput,
  type BtoonErrorCode,
  type CodecRegistry,
  type Compression,
  type CompressionAlgorithm,
  type DecodeOptions,
  type DeprecatedCompression,
  type EncodeOptions,
} from 'btoon';

const v: '0.3.0' = VERSION;
const spec: '0.3' = SPEC_VERSION;
const legacy: string = version();
const viaDefault: typeof encode = btoon.encode;

const bytes: Buffer = encode({ a: 1, b: [true, null], when: new Date() });
const asView: Uint8Array = bytes;
const value: unknown = decode(bytes);
decode(bytes.buffer);
decode(new DataView(bytes.buffer));
decode(new SharedArrayBuffer(1));
const input: BinaryInput = new Int16Array(4);
decode(input, { strict: false, maxDepth: 10, timestamps: 'object', bigint: 'always' });

const algorithm: CompressionAlgorithm = 'zstd';
const available: boolean = compressionAvailable(algorithm);
const codecs: CodecRegistry = { zlib: { decompress: (d: Uint8Array) => d } };
const encodeOptions: EncodeOptions = { compress: true, compression: 'zlib', autoTabular: false, maxDepth: 64, hmacKey: 'secret', codecs };
const decodeOptions: DecodeOptions = { maxDecompressedSize: 1 << 20, maxValues: 1 << 24, autoDecompress: true, hmacKey: new Uint8Array(32) };
// @ts-expect-error: "no key" is an absent option, not null
const nullKey: DecodeOptions = { hmacKey: null };
// 'auto' still compiles: a deprecated alias for 'zlib' (not in @btoon/js).
const auto: EncodeOptions = { compression: 'auto' };
const deprecatedAlgorithm: DeprecatedCompression = 'auto';
const legacyAlgorithm: Compression = 'auto';
// @ts-expect-error: not an algorithm
const gzip: EncodeOptions = { compression: 'gzip' };
// @ts-expect-error: not a timestamps mode
const badMode: DecodeOptions = { timestamps: 'iso' };

async function roundTrip(): Promise<unknown> {
  const packed: Buffer = await encodeAsync(value, encodeOptions);
  return decodeAsync(packed, decodeOptions);
}

try {
  decode(new Uint8Array([0xc1]));
} catch (e) {
  if (e instanceof BtoonError) {
    const code: BtoonErrorCode = e.code;
    void code;
  }
}
// @ts-expect-error: not an error code
new BtoonError('nope', 'x');
const err = new BtoonError('invalid_argument', 'x', { cause: new Error('inner') });

const ts = new Timestamp(1704067200n, 500, -330);
const ts2 = new Timestamp(5n); // nanoseconds default to 0
const seconds: bigint = ts.seconds;
const offset: number | undefined = ts.offsetMinutes;
const date: Date = ts.toDate();
const fromDate: Timestamp = Timestamp.fromDate(new Date(0));
const ext = new Ext(42, new Uint8Array([1, 2, 3]));
const extData: Uint8Array = ext.data;
// @ts-expect-error: Ext data is a Uint8Array (as in @btoon/js)
new Ext(1, [1, 2]);

const day = new BtoonDate(1700000000123n);
const dayMs: bigint = day.epochMilliseconds;
const dayAsTimestamp: Timestamp = day;
const dayFromTs: BtoonDate = BtoonDate.fromTimestamp(ts2);
const at = new BtoonDateTime(-1);
const atNs: bigint = at.epochNanoseconds;
const atFromDate: BtoonDateTime = BtoonDateTime.fromDate(new Date(0));
encode([day, at, ts]);

function describe(x: unknown): string {
  if (x instanceof BtoonDateTime) return `datetime ${x.epochNanoseconds}`;
  if (x instanceof BtoonDate) return `date ${x.epochMilliseconds}`;
  if (x instanceof Timestamp) return `timestamp ${x.seconds}`;
  if (x instanceof Ext) return `ext ${x.type}`;
  return typeof x;
}

export {
  asView, at, atFromDate, atNs, auto, available, badMode, deprecatedAlgorithm, gzip, legacyAlgorithm, date, dayAsTimestamp, dayFromTs, dayMs, describe, err, extData,
  fromDate, legacy, nullKey, offset, roundTrip, seconds, spec, v, viaDefault,
};
