import {z} from "zod";

/** Shared format, not color normalization. Alpha stays explicit on every input. */
export const gameRgbaColor=z.string().regex(/^#[a-fA-F0-9]{8}$/,
  "Use #RRGGBBAA: exactly 8 hex digits after #, including alpha (ff opaque, 00 transparent). Short hex and CSS color names are not accepted.")
  .describe("RGBA hex #RRGGBBAA: exactly 8 hex digits after #. Alpha ff is opaque, 00 transparent. Do not omit alpha or use short hex/CSS color names.");
