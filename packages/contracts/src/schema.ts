import { z } from "zod";

export const identifier = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_.:-]+$/);
