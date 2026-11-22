/**
 * Detects browsers that scramble pixel readback to block fingerprinting (Firefox Focus, and Firefox
 * with strict tracking protection or resistFingerprinting, add noise to getImageData/readPixels).
 * The pose model reads its results back from the GPU and the takeaway check reads frame pixels, so
 * on such a browser the skeleton comes out wrong and frames go undetected.
 */

let cached: boolean | null = null;

const SIZE = 64;

/** A pattern with every channel varying, so any per-pixel noise shows up. */
function expected(i: number): [number, number, number] {
  const x = i % SIZE;
  const y = Math.floor(i / SIZE);
  return [(x * 4) & 255, (y * 4) & 255, ((x + y) * 2) & 255];
}

function check2d(): boolean {
  const c = document.createElement("canvas");
  c.width = c.height = SIZE;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return false;
  const img = ctx.createImageData(SIZE, SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const [r, g, b] = expected(i);
    img.data.set([r, g, b, 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  const got = ctx.getImageData(0, 0, SIZE, SIZE).data;
  for (let i = 0; i < SIZE * SIZE; i++) {
    const [r, g, b] = expected(i);
    if (got[i * 4] !== r || got[i * 4 + 1] !== g || got[i * 4 + 2] !== b) return true;
  }
  return false;
}

function checkWebgl(): boolean {
  const c = document.createElement("canvas");
  c.width = c.height = SIZE;
  const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext | null;
  if (!gl) return false;
  try {
    gl.clearColor(32 / 255, 96 / 255, 160 / 255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const px = new Uint8Array(SIZE * SIZE * 4);
    gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, px);
    for (let i = 0; i < px.length; i += 4) {
      if (px[i] !== 32 || px[i + 1] !== 96 || px[i + 2] !== 160) return true;
    }
    return false;
  } finally {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}

/** True if this browser alters pixel data read back from a 2D or WebGL canvas. */
export function pixelReadbackScrambled(): boolean {
  if (cached !== null) return cached;
  try {
    cached = check2d() || checkWebgl();
  } catch {
    cached = false;
  }
  return cached;
}
