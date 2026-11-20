import { gameAssetOperation } from "../../contracts/src/game-assets";
import { imageProcessor } from "./images";
import { renderAudio } from "./audio";
import { renderVectorImage, type VectorRasterizer } from "./vector";
import type { ProcessedGameAsset } from "../../game-production/src/index";

/** Pure codecs only. No providers, project JS, host tools, files or agent loop. */
export function processGameMedia(value: unknown, files: Map<string,Buffer>, rasterize?: VectorRasterizer): ProcessedGameAsset {
  const operation=gameAssetOperation.parse(value);
  if(operation.type==="library.copy")throw new Error("Library copies require the installed verified library processor.");
  if(operation.type==="audio.encode")throw new Error("Audio encoding requires the provisioned isolated codec processor.");
  if(operation.type==="model.scene")throw new Error("3D recipes require the provisioned isolated Blender processor.");
  if(operation.type==="image.vector")return renderVectorImage(operation,rasterize);
  const images=imageProcessor(files);
  return operation.type==="image.compose"?images.compose(operation):operation.type==="image.atlas"?images.atlas(operation):renderAudio(operation,files);
}
