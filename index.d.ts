/// <reference types="node" />
/**
 * btoon — BTOON for Node.js (native). Same API and behavior as @btoon/js, except that
 * `encode` returns a Buffer, binaries decode to Buffers, `options.codecs` isn't used,
 * `compressionAvailable()` and `version()` are extra, and `compression: 'auto'` is still
 * accepted as a deprecated alias for 'zlib'.
 * Spec: https://github.com/BTOON-project/btoon-core/blob/main/docs/SPEC.md
 */

export declare const VERSION: '0.3.0';
export declare const SPEC_VERSION: '0.3';

export type CompressionAlgorithm = 'zlib' | 'lz4' | 'zstd' | 'brotli' | 'snappy';
/**
 * @deprecated `'auto'` is an alias for `'zlib'`, kept for code written for 0.2: use `'zlib'`, or
 * leave `compression` out. Passing it emits a DeprecationWarning (code `BTOON_DEP_AUTO`) once
 * per process. @btoon/js doesn't accept it.
 */
export type DeprecatedCompression = 'auto';
/** @deprecated use CompressionAlgorithm. */
export type Compression = CompressionAlgorithm | DeprecatedCompression;

export type BtoonErrorCode =
  | 'truncated'
  | 'invalid_marker'
  | 'trailing_data'
  | 'invalid_utf8'
  | 'non_string_key'
  | 'duplicate_key'
  | 'max_depth'
  | 'invalid_extension'
  | 'invalid_tabular'
  | 'invalid_envelope'
  | 'size_limit'
  | 'unsupported_compression'
  | 'authentication_failed'
  | 'invalid_argument';

/**
 * The only error type encode/decode throw (and the async forms reject with). `code` is a spec
 * error code. `instanceof BtoonError` holds for errors from @btoon/js too (a brand check).
 */
export declare class BtoonError extends Error {
  constructor(code: BtoonErrorCode, message: string, options?: { cause?: unknown });
  readonly code: BtoonErrorCode;
  static [Symbol.hasInstance](value: unknown): value is BtoonError;
}

/**
 * An extension value BTOON doesn't interpret. The ids BTOON defines (-1…-6, -10) construct,
 * but encoding such an `Ext` throws `invalid_argument` (spec §5.7): those types are written
 * from their typed values (Date/Timestamp, BtoonDate, BtoonDateTime, bigint,
 * Float32Array/Float64Array, arrays of objects). Ids reserved for future versions (-7…-9,
 * -11…-128) are written as given.
 */
export declare class Ext {
  /**
   * @throws {BtoonError} `invalid_argument` unless `type` is an integer in [-128, 127] and
   *   `data` is a Uint8Array (a Buffer is one).
   */
  constructor(type: number, data: Uint8Array);
  readonly type: number;
  readonly data: Uint8Array;
  static [Symbol.hasInstance](value: unknown): value is Ext;
}

/** A timestamp (extension -1): a nanosecond-precision instant with an optional UTC offset in minutes. */
export declare class Timestamp {
  /**
   * @param seconds Seconds since the Unix epoch (UTC): a bigint in the int64 range, or a safe-integer number.
   * @param nanoseconds An integer in [0, 999999999] (default 0).
   * @param offsetMinutes An integer in [-1080, 1080], or undefined for none.
   * @throws {BtoonError} `invalid_argument` if a field is out of range.
   */
  constructor(seconds: bigint | number, nanoseconds?: number, offsetMinutes?: number);
  readonly seconds: bigint;
  readonly nanoseconds: number;
  readonly offsetMinutes?: number;
  /**
   * Millisecond-precision Date (the offset is dropped).
   * @throws {BtoonError} `invalid_argument` outside the range of Date (±8.64e15 ms).
   */
  toDate(): Date;
  /** @throws {BtoonError} `invalid_argument` for an invalid Date. */
  static fromDate(date: Date): Timestamp;
  static [Symbol.hasInstance](value: unknown): value is Timestamp;
}

/**
 * A date (extension -2): milliseconds since the Unix epoch, UTC, with no offset.
 * `epochMilliseconds` is the exact value on the wire; `seconds` and `nanoseconds` describe the
 * same instant (floored) and `offsetMinutes` is undefined.
 */
export declare class BtoonDate extends Timestamp {
  /** @throws {BtoonError} `invalid_argument` unless a bigint in the int64 range or a safe-integer number. */
  constructor(epochMilliseconds: bigint | number);
  readonly epochMilliseconds: bigint;
  /** @throws {BtoonError} `invalid_argument` for an invalid Date. */
  static fromDate(date: Date): BtoonDate;
  /**
   * Floors to the millisecond.
   * @throws {BtoonError} `invalid_argument` for a Timestamp with a UTC offset, or one out of range.
   */
  static fromTimestamp(ts: Timestamp): BtoonDate;
  static [Symbol.hasInstance](value: unknown): value is BtoonDate;
}

/**
 * A datetime (extension -3): nanoseconds since the Unix epoch, UTC, with no offset (1677-09-21
 * to 2262-04-11). `epochNanoseconds` is the exact value on the wire.
 */
export declare class BtoonDateTime extends Timestamp {
  /** @throws {BtoonError} `invalid_argument` unless a bigint in the int64 range or a safe-integer number. */
  constructor(epochNanoseconds: bigint | number);
  readonly epochNanoseconds: bigint;
  /** @throws {BtoonError} `invalid_argument` for an invalid Date, or one outside the datetime range. */
  static fromDate(date: Date): BtoonDateTime;
  /**
   * Exact.
   * @throws {BtoonError} `invalid_argument` for a Timestamp with a UTC offset, or one out of range.
   */
  static fromTimestamp(ts: Timestamp): BtoonDateTime;
  static [Symbol.hasInstance](value: unknown): value is BtoonDateTime;
}

/** @btoon/js's caller-supplied compression codecs: checked like there, but not used by this package. */
export interface Codec {
  compress?(data: Uint8Array): Uint8Array | Promise<Uint8Array>;
  decompress?(data: Uint8Array, uncompressedSize: number): Uint8Array | Promise<Uint8Array>;
}
export type CodecRegistry = { readonly [A in CompressionAlgorithm]?: Codec };

export interface EncodeOptions {
  /** Wrap in a compression envelope (skipped if it wouldn't save ≥ 5% or input < 256 bytes). Default false. */
  compress?: boolean;
  /**
   * Algorithm for `compress` (default 'zlib'). See compressionAvailable(). `'auto'` is a
   * deprecated alias for 'zlib' ({@link DeprecatedCompression}).
   */
  compression?: CompressionAlgorithm | DeprecatedCompression;
  /** Columnar encoding for arrays of uniform objects when smaller (default true). */
  autoTabular?: boolean;
  /**
   * Nesting limit (default 128, at most 1000: a larger value throws 'invalid_argument');
   * cycles fail with code 'max_depth'.
   */
  maxDepth?: number;
  /**
   * Sign with HMAC-SHA256. A string is used as its UTF-8 bytes. An empty key, `null`, or a
   * string with a lone surrogate throws 'invalid_argument'. Leave it undefined for no
   * signature.
   */
  hmacKey?: Uint8Array | string;
  /** Checked as in @btoon/js, but not used: this package compresses with the codecs built into it. */
  codecs?: CodecRegistry;
}

export interface DecodeOptions {
  /**
   * Reject trailing bytes, invalid UTF-8 and duplicate keys (default true). Map keys and
   * column names must be valid UTF-8 either way.
   */
  strict?: boolean;
  /** Nesting limit (default 128, at most 1000: a larger value throws 'invalid_argument'). */
  maxDepth?: number;
  /**
   * Upper bound for compressed input after decompression, in bytes (default 64 MiB). It also
   * bounds the column-name bytes a table copies into its rows (rows × the names' UTF-8
   * bytes). Exceeding it throws 'size_limit'.
   */
  maxDecompressedSize?: number;
  /**
   * Upper bound for the number of values a document decodes to (default 1,048,576 = 2^20);
   * more throw 'size_limit'. Every value counts once: the top-level value, array elements,
   * object values (not keys), extension values, and each table row and cell. Values inside a
   * compression envelope count. Raise it to decode larger documents.
   */
  maxValues?: number;
  /** Accept compression envelopes (default true). */
  autoDecompress?: boolean;
  /** Require and verify an HMAC-SHA256 signature. The key's rules are as for encode. */
  hmacKey?: Uint8Array | string;
  /**
   * 'date' (default): a millisecond Date; an instant outside the range of Date gives a
   * Timestamp, or a BtoonDate for a date. 'object': lossless, a Timestamp, BtoonDate or
   * BtoonDateTime, which encode back to the same bytes.
   */
  timestamps?: 'date' | 'object';
  /**
   * Which integers decode to `bigint`; the rest are numbers. The type depends on the value,
   * never on how the input encoded it (spec §7).
   * - 'auto' (default): every integer outside the safe range [-(2^53-1), 2^53-1].
   * - 'always': every integer outside [-2^31, 2^32-1], even a safe one: what a canonical encoder
   *   writes as uint64, int64 or a bigint extension.
   */
  bigint?: 'auto' | 'always';
  /** Checked as in @btoon/js, but not used: this package decompresses with the codecs built into it. */
  codecs?: CodecRegistry;
}

/**
 * Values that encode: null/undefined, boolean, number, bigint, string, Uint8Array/Buffer/
 * ArrayBuffer/SharedArrayBuffer/DataView/other typed arrays (binary), Float32Array/Float64Array
 * (vectors), Date and Timestamp (timestamps), BtoonDate (dates), BtoonDateTime (datetimes), Ext,
 * arrays, Maps with string keys and objects (own enumerable string-keyed properties; toJSON()
 * is honored, for plain objects an own one). Number/String/Boolean/BigInt wrappers are
 * unwrapped. Proxies (Vue and MobX reactive state) encode like their targets.
 */
export type Encodable = unknown;

/** Input decode accepts. A SharedArrayBuffer (or a view of one) is copied first. */
export type BinaryInput = Uint8Array | ArrayBuffer | SharedArrayBuffer | ArrayBufferView;

export declare function encode(value: Encodable, options?: EncodeOptions): Buffer;
export declare function decode(data: BinaryInput, options?: DecodeOptions): unknown;
export declare function encodeAsync(value: Encodable, options?: EncodeOptions): Promise<Buffer>;
export declare function decodeAsync(data: BinaryInput, options?: DecodeOptions): Promise<unknown>;
/**
 * True if this build supports the compression algorithm ('zlib' always is; the builds have only
 * zlib). `'auto'` is a deprecated alias for 'zlib'.
 */
export declare function compressionAvailable(algorithm: CompressionAlgorithm | DeprecatedCompression): boolean;
/** @deprecated use VERSION */
export declare function version(): string;
