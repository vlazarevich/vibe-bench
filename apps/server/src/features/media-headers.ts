/** Header-only checks for previewable media. Decoding happens in the viewer's browser, never on the server. */
export const MAX_MEDIA_PIXELS = 40_000_000;

type Dimensions = { width: number; height: number };

function pngDimensions(bytes: Buffer): Dimensions | null {
  if (bytes.length < 24 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegDimensions(bytes: Buffer): Dimensions | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xff) {
      offset++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) return null;
    // Start-of-frame markers carry the image size; C4, C8 and CC are other segment types.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (offset + 9 > bytes.length) return null;
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function webpDimensions(bytes: Buffer): Dimensions | null {
  if (bytes.length < 30 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP')
    return null;
  const chunk = bytes.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') {
    if (bytes.subarray(23, 26).toString('hex') !== '9d012a') return null;
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (bytes[20] !== 0x2f) return null;
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  return null;
}

function webmHeader(bytes: Buffer) {
  // EBML magic followed by a DocType element (0x4282) naming "webm" within the header.
  if (bytes.length < 16 || bytes.subarray(0, 4).toString('hex') !== '1a45dfa3') return false;
  const header = bytes.subarray(0, 64);
  const docType = header.indexOf(Buffer.from([0x42, 0x82]));
  return docType >= 0 && header.indexOf(Buffer.from('webm'), docType) > docType;
}

/** True when the bytes carry a supported signature and, for images, plausible bounded dimensions. */
export function previewableMedia(bytes: Buffer, mediaType: string) {
  if (mediaType === 'video/webm') return webmHeader(bytes);
  const size =
    mediaType === 'image/png'
      ? pngDimensions(bytes)
      : mediaType === 'image/jpeg'
        ? jpegDimensions(bytes)
        : mediaType === 'image/webp'
          ? webpDimensions(bytes)
          : null;
  return !!size && size.width > 0 && size.height > 0 && size.width * size.height <= MAX_MEDIA_PIXELS;
}
