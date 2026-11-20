import { z } from "zod";
import { identifier } from "./schema";
import { gameFilePath } from "./games";
import {gameRgbaColor} from "./game-colors";

const number = z.number().finite().min(-8192).max(8192);
const positive = z.number().finite().min(.01).max(8192);
const color = gameRgbaColor;
const stops = z.array(z.object({ offset: z.number().min(0).max(1), color }).strict()).min(2).max(16)
  .refine(values => values.every((value, index) => !index || value.offset >= values[index - 1]!.offset), "Gradient stops must be in nondecreasing order.");
export const gameVectorPaint = z.union([color,
  z.object({ type: z.literal("linear"), x1: number, y1: number, x2: number, y2: number, stops }).strict()
    .refine(paint => paint.x1 !== paint.x2 || paint.y1 !== paint.y2, "Linear gradient endpoints must differ."),
  z.object({ type: z.literal("radial"), cx: number, cy: number, r: positive, stops }).strict(),
]).describe("Paint is #RRGGBBAA with explicit alpha, or a typed linear/radial gradient object. Hex strings always have 8 digits after #; never CSS names.");
export const gameVectorPathCommand = z.discriminatedUnion("op", [
  z.object({ op: z.literal("M"), x: number, y: number }).strict(),
  z.object({ op: z.literal("L"), x: number, y: number }).strict(),
  z.object({ op: z.literal("Q"), cx: number.describe("Quadratic Q control point x. Q requires numeric cx, cy, x, y. Cubic C instead uses x1, y1, x2, y2, x, y."),
    cy: number.describe("Quadratic Q control point y. Q requires numeric cx, cy, x, y. Cubic C instead uses x1, y1, x2, y2, x, y."), x: number, y: number }).strict(),
  z.object({ op: z.literal("C"), x1: number, y1: number, x2: number, y2: number, x: number, y: number }).strict(),
  z.object({ op: z.literal("Z") }).strict(),
]);
const style = {
  id: identifier,
  fill: gameVectorPaint.nullable().default("#ffffffff").describe("Fill is null for no fill, #RRGGBBAA with explicit alpha, or a typed gradient object. Hex strings always have 8 digits after #; do not use CSS names."),
  stroke: z.object({ paint: gameVectorPaint, width: z.number().finite().min(.01).max(256),
    cap: z.enum(["butt", "round", "square"]).default("round"), join: z.enum(["round", "bevel", "miter"]).default("round") }).strict().optional(),
  opacity: z.number().min(0).max(1).default(1),
  transform: z.object({ x: number.default(0), y: number.default(0), rotation: z.number().min(-360).max(360).default(0),
    scaleX: z.number().min(.01).max(16).default(1), scaleY: z.number().min(.01).max(16).default(1),
    pivotX: number.default(0), pivotY: number.default(0) }).strict().optional(),
};
export const gameVectorShape = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("rect"), ...style, x: number, y: number, width: positive, height: positive, radius: z.number().min(0).max(4096).default(0) }).strict(),
  z.object({ kind: z.literal("ellipse"), ...style, cx: number, cy: number, rx: positive, ry: positive }).strict(),
  z.object({ kind: z.literal("path"), ...style, fillRule: z.enum(["nonzero", "evenodd"]).default("nonzero"), commands: z.array(gameVectorPathCommand).min(2).max(256) }).strict(),
]);
export const vectorRecipePath = (output: string) => output.slice(0, -4) + ".vector.json";
export const gameVectorImageOperation = z.object({
  type: z.literal("image.vector"),
  output: gameFilePath.refine(name => name.startsWith("assets/") && /\.(svg|png)$/.test(name), "Vector output must be an assets/*.svg or assets/*.png path.")
    .describe("Choose .svg for self-contained vector art or .png for actual locally rasterized pixels usable in sprites/atlases. Both preserve an editable .vector.json recipe. Changing an extension never renames existing bytes.")
    .refine(name => gameFilePath.safeParse(vectorRecipePath(name)).success, "Vector recipe sidecar must fit portable path limits."),
  width: z.number().int().min(1).max(4096), height: z.number().int().min(1).max(4096),
  background: color.default("#00000000"), shapes: z.array(gameVectorShape).min(1).max(512),
}).strict().superRefine((operation, context) => {
  if (new Set(operation.shapes.map(shape => shape.id)).size !== operation.shapes.length)
    context.addIssue({ code: "custom", path: ["shapes"], message: "Vector shape identities must be unique." });
  let commands = 0;
  for (const [index, shape] of operation.shapes.entries()) if (shape.kind === "path") {
    commands += shape.commands.length;let open = false;
    for (const [commandIndex, command] of shape.commands.entries()) {
      if (command.op === "M") open = true;
      else if (!open) context.addIssue({ code: "custom", path: ["shapes", index, "commands", commandIndex], message: "Start each path/subpath with M before drawing or closing it." });
      if (command.op === "Z") open = false;
    }
  }
  if (commands > 4096) context.addIssue({ code: "custom", path: ["shapes"], message: "Vector scene exceeds the 4096-command budget." });
});
export type GameVectorImageOperation = z.infer<typeof gameVectorImageOperation>;

export const gameVectorGuide = `image.vector creates original SVG or PNG art from typed data, never submitted SVG/XML, JS or prepared image bytes. Operation: {type:"image.vector",output:"assets/name.svg" OR "assets/name.png",width:1..4096,height:1..4096,background?:"#RRGGBBAA",shapes:[...]}. PNG is rasterized by the pinned local codec, not renamed SVG. Use 1..512 unique shape IDs and at most4096 path commands total.
Shapes: {kind:"rect",id,x,y,width,height,radius?}, {kind:"ellipse",id,cx,cy,rx,ry}, or {kind:"path",id,commands:[{op:"M",x,y},{op:"L",x,y},{op:"Q",cx,cy,x,y},{op:"C",x1,y1,x2,y2,x,y},{op:"Z"}],fillRule?:"nonzero"|"evenodd"}. Start each subpath with M. Coordinate range -8192..8192; up to256 commands per path.
Each shape accepts fill (RGBA hex, null for none, or gradient), opacity0..1, stroke?:{paint,width:0.01..256,cap?,join?}, transform?:{x,y,rotation,scaleX,scaleY,pivotX,pivotY}. Every color string is exactly #RRGGBBAA, including alpha: ff opaque, 00 transparent. Do not use #RGB, #RRGGBB, names or CSS functions. Gradient: {type:"linear",x1,y1,x2,y2,stops:[{offset:0..1,color:"#RRGGBBAA"}]} or {type:"radial",cx,cy,r,stops}; 2..16 sorted stops.
No markup, text/fonts, images, CSS, event handlers, animation elements, links, external resources or code. Output includes the chosen actual SVG/PNG and a .vector.json recipe sidecar; origin/license stay declared-unverified. Apply the acknowledged candidate explicitly. Phaser loads SVG with load.svg and PNG with load.image. PNG output can feed PNG composition/atlas after explicit application; SVG itself is not an accepted atlas input. A generated illustration is not proof of artistic/game/human acceptance.`;
