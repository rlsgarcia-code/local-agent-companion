import { createHash } from "node:crypto";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import lock from "../rasterizer.lock.json";
import type { VectorRasterizer } from "./vector";

/** Private worker-only codec. Callers must supply only serializer-owned SVG,
 * never project markup. Wasm bytes come from the verified process owner. */
export async function initializeVectorRasterizer(bytes: Uint8Array): Promise<VectorRasterizer> {
  if (bytes.byteLength !== lock.wasm.size || createHash("sha256").update(bytes).digest("hex") !== lock.wasm.sha256)
    throw new Error("Vector rasterizer integrity mismatch.");
  await initWasm(bytes);
  return (svg, width, height) => {
    const renderer = new Resvg(svg, { font: { loadSystemFonts: false } });
    try {
      if (renderer.width !== width || renderer.height !== height || renderer.imagesToResolve().length)
        throw new Error("Vector rasterizer input does not match its closed geometry contract.");
      const image = renderer.render();
      try {
        if (image.width !== width || image.height !== height) throw new Error("Vector rasterizer dimensions changed.");
        return image.asPng().slice();
      } finally { image.free(); }
    } finally { renderer.free(); }
  };
}
