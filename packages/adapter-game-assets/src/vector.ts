import { gameVectorImageOperation, vectorRecipePath, type GameVectorImageOperation } from "../../contracts/src/game-vector";
import type { ProcessedGameAsset } from "../../game-production/src/index";

/** Serialize only closed typed geometry. No project XML, entity, URL, CSS,
 * font, image, renderer program or host-selected path is ever interpreted. */
export type VectorRasterizer = (svg: Uint8Array, width: number, height: number) => Uint8Array;
export function renderVectorImage(input: unknown, rasterize?: VectorRasterizer): ProcessedGameAsset {
  const scene = gameVectorImageOperation.parse(input),defs: string[] = [];
  const rgba = (hex: string) => ({ color: hex.slice(0, 7), alpha: parseInt(hex.slice(7), 16) / 255 });
  type Paint = NonNullable<GameVectorImageOperation["shapes"][number]["fill"]>;
  function paint(value: Paint | null, name: "fill" | "stroke"): string {
    if (value === null) return `${name}="none"`;
    if (typeof value === "string") { const color = rgba(value);return `${name}="${color.color}" ${name}-opacity="${color.alpha}"`; }
    const id = `paint-${defs.length}`,stops = value.stops.map(stop => { const color = rgba(stop.color);return `<stop offset="${stop.offset}" stop-color="${color.color}" stop-opacity="${color.alpha}"/>`; }).join("");
    defs.push(value.type === "linear" ? `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${value.x1}" y1="${value.y1}" x2="${value.x2}" y2="${value.y2}">${stops}</linearGradient>`
      : `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${value.cx}" cy="${value.cy}" r="${value.r}">${stops}</radialGradient>`);
    return `${name}="url(#${id})"`;
  }
  const shapes = scene.shapes.map(shape => {
    const attributes = [paint(shape.fill, "fill"), `opacity="${shape.opacity}"`];
    if (shape.stroke) attributes.push(paint(shape.stroke.paint, "stroke"), `stroke-width="${shape.stroke.width}" stroke-linecap="${shape.stroke.cap}" stroke-linejoin="${shape.stroke.join}" stroke-miterlimit="4"`);
    if (shape.transform) { const t = shape.transform;attributes.push(`transform="translate(${t.x} ${t.y}) translate(${t.pivotX} ${t.pivotY}) rotate(${t.rotation}) scale(${t.scaleX} ${t.scaleY}) translate(${-t.pivotX} ${-t.pivotY})"`); }
    const style = attributes.join(" ");
    if (shape.kind === "rect") return `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" rx="${shape.radius}" ${style}/>`;
    if (shape.kind === "ellipse") return `<ellipse cx="${shape.cx}" cy="${shape.cy}" rx="${shape.rx}" ry="${shape.ry}" ${style}/>`;
    const d = shape.commands.map(command => command.op === "Z" ? "Z" : command.op === "C" ? `C${command.x1} ${command.y1} ${command.x2} ${command.y2} ${command.x} ${command.y}`
      : command.op === "Q" ? `Q${command.cx} ${command.cy} ${command.x} ${command.y}` : `${command.op}${command.x} ${command.y}`).join(" ");
    return `<path d="${d}" fill-rule="${shape.fillRule}" ${style}/>`;
  });
  const background = paint(scene.background, "fill");
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${scene.width}" height="${scene.height}" viewBox="0 0 ${scene.width} ${scene.height}"><defs>${defs.join("")}</defs><rect width="${scene.width}" height="${scene.height}" ${background}/>${shapes.join("")}</svg>`);
  if (svg.length > 1024 * 1024) throw new Error("Vector output exceeds its 1 MiB budget; preserve the recipe and split the illustration.");
  const png = scene.output.endsWith(".png");
  if (png && !rasterize) throw new Error("PNG vector output requires the verified packaged rasterizer; no SVG bytes were renamed.");
  const data = png ? Buffer.from(rasterize!(svg, scene.width, scene.height)) : svg;
  if (data.length > 64 * 1024 * 1024) throw new Error("Vector raster output exceeds its 64 MiB budget.");
  return { files: [{ path: scene.output, mime: png ? "image/png" : "image/svg+xml", data }, { path: vectorRecipePath(scene.output), mime: "application/json", data: Buffer.from(JSON.stringify({ schemaVersion: 1, operation: scene })) }],
    info: { width: scene.width, height: scene.height, shapes: scene.shapes.length, gradients: defs.length, format: png ? "PNG from typed vector geometry" : "Self-contained typed SVG", renderer: png ? "Pinned local resvg WebAssembly; no fonts, images or external resources" : "Browser image resource; no scripts or external resources" } };
}
