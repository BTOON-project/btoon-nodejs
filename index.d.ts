/**
 * BTOON: Binary TOON serialization format
 * Node.js bindings for high-performance binary encoding/decoding
 */

export interface EncodeOptions {
  /** Enable zlib compression */
  compress?: boolean;
  /** Automatically detect and optimize tabular data */
  autoTabular?: boolean;
}

export interface DecodeOptions {
  /** Enable zlib decompression */
  decompress?: boolean;
}

/**
 * Encode a JavaScript value to BTOON binary format
 * @param value - The value to encode
 * @param options - Encoding options
 * @returns Binary encoded data as Buffer
 */
export function encode(value: any, options?: EncodeOptions): Buffer;

/**
 * Decode BTOON binary data to a JavaScript value
 * @param data - Binary data to decode
 * @param options - Decoding options
 * @returns Decoded JavaScript value
 */
export function decode(data: Buffer, options?: DecodeOptions): any;

/**
 * Get the BTOON version string
 * @returns Version string
 */
export function version(): string;
