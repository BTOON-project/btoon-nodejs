/**
 * btoon — BTOON for Node.js (native). Same API as @btoon/js.
 * Spec: https://github.com/BTOON-project/btoon-core/blob/main/docs/SPEC.md
 */

export declare const VERSION: string;
export declare const SPEC_VERSION: string;

export type Compression = 'zlib' | 'lz4' | 'zstd' | 'brotli' | 'snappy' | 'auto';

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

export declare class BtoonError extends Error {
  constructor(code: BtoonErrorCode, message: string);
  readonly code: BtoonErrorCode;
}

/**
 * An extension value BTOON doesn't interpret. The ids BTOON defines (-1…-6, -10) construct,
 * but encoding such an `Ext` throws `invalid_argument` (spec §5.7): those types are written
 * from their typed values (Date/Timestamp, bigint, Float32Array/Float64Array, arrays of
 * objects). Ids reserved for future versions (-7…-9, -11…-128) are written as given.
 */
export declare class Ext {
  /** @throws {BtoonError} `invalid_argument` unless `type` is an integer in [-128, 127]. */
  constructor(type: number, data: Uint8Array | ArrayLike<number>);
  readonly type: number;
  readonly data: Uint8Array;
}

/** Nanosecond-precision instant with an optional UTC offset in minutes. */
export declare class Timestamp {
  /**
   * @param seconds Seconds since the Unix epoch (UTC); must fit in a signed 64-bit integer.
   * @param nanoseconds An integer in [0, 999999999] (default 0).
   * @param offsetMinutes An integer in [-1080, 1080], or undefined for none.
   * @throws {BtoonError} `invalid_argument` if a field is out of range.
   */
  constructor(seconds: bigint | number, nanoseconds?: number, offsetMinutes?: number);
  readonly seconds: bigint;
  readonly nanoseconds: number;
  readonly offsetMinutes: number | undefined;
  /**
   * Millisecond-precision Date (the offset is dropped).
   * @throws {BtoonError} `invalid_argument` outside the range of Date (±8.64e15 ms).
   */
  toDate(): Date;
  /** @throws {BtoonError} `invalid_argument` for an invalid Date. */
  static fromDate(date: Date): Timestamp;
}

export interface EncodeOptions {
  /** Wrap in a compression envelope (skipped if it wouldn't save ≥ 5% or input < 256 bytes). */
  compress?: boolean;
  /** Algorithm for `compress` (default 'zlib'). See compressionAvailable(). */
  compression?: Compression;
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
   * 'date' (default): a millisecond Date, or a Timestamp for an instant outside the range of
   * Date. 'object': always a Timestamp (lossless).
   */
  timestamps?: 'date' | 'object';
  /** 'auto' (default: bigint only beyond Number.MAX_SAFE_INTEGER) or 'always'. */
  bigint?: 'auto' | 'always';
}

/**
 * Values that encode: null/undefined, boolean, number, bigint, string, Uint8Array/Buffer/
 * ArrayBuffer/DataView/other typed arrays (binary), Float32Array/Float64Array (vectors),
 * Date, Timestamp, Ext, arrays, Maps with string keys and objects (own enumerable
 * string-keyed properties; toJSON() is honored). Proxied arrays, objects and class
 * instances, and reactive Maps (Vue, MobX), encode like their targets.
 */
export type Encodable = unknown;

export declare function encode(value: Encodable, options?: EncodeOptions): Buffer;
export declare function decode(data: Uint8Array | ArrayBuffer | DataView, options?: DecodeOptions): unknown;
export declare function encodeAsync(value: Encodable, options?: EncodeOptions): Promise<Buffer>;
export declare function decodeAsync(data: Uint8Array | ArrayBuffer | DataView, options?: DecodeOptions): Promise<unknown>;
export declare function compressionAvailable(algorithm: Compression): boolean;
/** @deprecated use VERSION */
export declare function version(): string;
