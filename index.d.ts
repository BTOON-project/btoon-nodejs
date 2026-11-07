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

/** An extension value BTOON doesn't interpret. */
export declare class Ext {
  constructor(type: number, data: Uint8Array | ArrayLike<number>);
  readonly type: number;
  readonly data: Uint8Array;
}

/** Nanosecond-precision instant with an optional UTC offset in minutes. */
export declare class Timestamp {
  constructor(seconds: bigint | number, nanoseconds?: number, offsetMinutes?: number);
  readonly seconds: bigint;
  readonly nanoseconds: number;
  readonly offsetMinutes: number | undefined;
  toDate(): Date;
  static fromDate(date: Date): Timestamp;
}

export interface EncodeOptions {
  /** Wrap in a compression envelope (skipped if it wouldn't save ≥ 5% or input < 256 bytes). */
  compress?: boolean;
  /** Algorithm for `compress` (default 'zlib'). See compressionAvailable(). */
  compression?: Compression;
  /** Columnar encoding for arrays of uniform objects when smaller (default true). */
  autoTabular?: boolean;
  /** Nesting limit (default 128); cycles fail with code 'max_depth'. */
  maxDepth?: number;
  /** Sign with HMAC-SHA256 (strings are UTF-8 encoded). */
  hmacKey?: Uint8Array | string;
}

export interface DecodeOptions {
  /** Reject trailing bytes, invalid UTF-8 and duplicate keys (default true). */
  strict?: boolean;
  maxDepth?: number;
  /** Upper bound for compressed input after decompression (default 256 MiB). */
  maxDecompressedSize?: number;
  /** Accept compression envelopes (default true). */
  autoDecompress?: boolean;
  /** Require and verify an HMAC-SHA256 signature. */
  hmacKey?: Uint8Array | string;
  /** 'date' (default, millisecond Date) or 'object' (Timestamp, lossless). */
  timestamps?: 'date' | 'object';
  /** 'auto' (default: bigint only beyond Number.MAX_SAFE_INTEGER) or 'always'. */
  bigint?: 'auto' | 'always';
}

/**
 * Values that encode: null/undefined, boolean, number, bigint, string, Uint8Array/Buffer/
 * ArrayBuffer/DataView/other typed arrays (binary), Float32Array/Float64Array (vectors),
 * Date, Timestamp, Ext, arrays, Maps with string keys and objects (own enumerable
 * string-keyed properties; toJSON() is honored).
 */
export type Encodable = unknown;

export declare function encode(value: Encodable, options?: EncodeOptions): Buffer;
export declare function decode(data: Uint8Array | ArrayBuffer | DataView, options?: DecodeOptions): unknown;
export declare function encodeAsync(value: Encodable, options?: EncodeOptions): Promise<Buffer>;
export declare function decodeAsync(data: Uint8Array | ArrayBuffer | DataView, options?: DecodeOptions): Promise<unknown>;
export declare function compressionAvailable(algorithm: Compression): boolean;
/** @deprecated use VERSION */
export declare function version(): string;
