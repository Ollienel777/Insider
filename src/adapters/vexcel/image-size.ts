// An image's pixel size, read from its header (JPEG or PNG), so the live
// adapter can pin entries to pixels without decoding the image.

export interface ImageSize {
  width: number;
  height: number;
  contentType: "image/jpeg" | "image/png";
}

export function imageSize(bytes: Uint8Array): ImageSize | null {
  const b = bytes;
  // PNG: the signature, then IHDR's width and height, big-endian.
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    return width > 0 && height > 0 ? { width, height, contentType: "image/png" } : null;
  }
  // JPEG: walk the segments to the first start-of-frame.
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) return null;
      // Any number of 0xFF fill bytes may precede a marker.
      while (b[i + 1] === 0xff) i++;
      const marker = b[i + 1];
      if (marker === undefined) return null;
      // TEM (01), RST0–RST7 (D0–D7), SOI (D8) and EOI (D9) carry no length.
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
        i += 2;
        continue;
      }
      if (i + 3 >= b.length) return null;
      const length = (b[i + 2] << 8) | b[i + 3];
      // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        if (i + 8 >= b.length) return null;
        const height = (b[i + 5] << 8) | b[i + 6];
        const width = (b[i + 7] << 8) | b[i + 8];
        return width > 0 && height > 0 ? { width, height, contentType: "image/jpeg" } : null;
      }
      if (length < 2) return null;
      i += 2 + length;
    }
  }
  return null;
}
