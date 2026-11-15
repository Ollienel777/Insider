// Turns one panorama face from its file bytes into plain pixels, off the main
// thread (issue 118). Plain pixels are what the GPU takes in the smallest,
// most even slices: handing it a decoded image instead costs a frame now and
// then, however the image is cut up.
//
// In: { id, blob, transform } where `transform` is null or the canvas
// transform that turns the face the way its cube slot wants it. Out:
// { id, size, pixels } with the pixel buffer handed over, not copied, or
// { id, failed: true }. Nothing is kept between messages.

export interface DecodeRequest {
  id: number;
  blob: Blob;
  transform: readonly [number, number, number, number] | null;
}

export type DecodeReply = { id: number; size: number; pixels: ArrayBuffer } | { id: number; failed: true };

interface WorkerScope {
  onmessage: ((event: MessageEvent<DecodeRequest>) => void) | null;
  postMessage(message: DecodeReply, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = async (event) => {
  const { id, blob, transform } = event.data;
  try {
    const bitmap = await createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
    const size = bitmap.width;
    if (bitmap.height !== size) throw new Error("not square");
    const canvas = new OffscreenCanvas(size, size);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("no 2d canvas");
    if (transform) {
      const [a, b, c, d] = transform;
      context.setTransform(a, b, c, d, size / 2, size / 2);
      context.drawImage(bitmap, -size / 2, -size / 2);
    } else {
      context.drawImage(bitmap, 0, 0);
    }
    bitmap.close();
    const pixels = context.getImageData(0, 0, size, size).data.buffer;
    scope.postMessage({ id, size, pixels }, [pixels]);
  } catch {
    scope.postMessage({ id, failed: true });
  }
};
