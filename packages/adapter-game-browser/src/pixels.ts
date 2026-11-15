import { PNG } from "pngjs";

/** Decode only collector-produced, bounded screenshots; never a game-provided result image. */
function decoded(data: Buffer) {
  if (data.length > 12 * 1024 * 1024 || data.length < 24 || data.readUInt32BE(16) > 1920 || data.readUInt32BE(20) > 1080)
    throw new Error("Screenshot exceeds the collector pixel budget.");
  return PNG.sync.read(data, { checkCRC: true });
}
export function imageDifference(before: Buffer, after: Buffer): number {
  const a = decoded(before), b = decoded(after);
  if (a.width !== b.width || a.height !== b.height) throw new Error("Image comparisons require the same canvas dimensions.");
  let changed = 0;
  for (let i = 0; i < a.data.length; i += 4)
    if (Math.max(...[0, 1, 2, 3].map((channel) => Math.abs(a.data[i + channel]! - b.data[i + channel]!))) > 12) changed++;
  return changed / (a.width * a.height);
}
export function hasRenderedPixels(data: Buffer): boolean {
  const image = decoded(data), colors = new Map<number, number>();
  const threshold = Math.max(1, image.width * image.height * 0.001);
  let total = 0, largest = 0;
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i + 3]! > 0) {
      const color = (image.data[i]! << 16) | (image.data[i + 1]! << 8) | image.data[i + 2]!;
      const count = (colors.get(color) ?? 0) + 1;
      colors.set(color, count); total++; largest = Math.max(largest, count);
      if (total - largest >= threshold) return true;
    }
  }
  // Flat two-color pixel art is valid. Observe a nonuniform opaque canvas rather
  // than requiring an arbitrary number of colors; this is not gameplay evidence.
  return false;
}
