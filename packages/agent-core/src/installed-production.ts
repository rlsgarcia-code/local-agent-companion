import { GameProductionFailure, GameProductionUncertain } from "../../game-production/src/index";
import { gameContentHash } from "../../game-design/src/project";
import { gameWebCompileRequest, gameWebCompileResult } from "../../contracts/src/game-web-compiler";
import { installedCoreGameBuildSchemas } from "../../contracts/src/kidos-game-builds";
import { installedCoreGameMediaSchemas } from "../../contracts/src/kidos-game-media";
import { gameMediaProcessRequest,gameMediaProcessResult } from "../../contracts/src/game-media-worker";
import { assetSourceInputs } from "../../contracts/src/game-assets";
import { gameMediaToolchain } from "../../adapter-game-assets/src/media-toolchain";
import { installedCoreGameValidationSchemas } from "../../contracts/src/kidos-game-validation";
import { gameBrowserProcessRequest,gameBrowserProcessResult } from "../../contracts/src/game-browser-worker";
import { gameBrowserCandidateToolchain } from "../../adapter-game-browser/src/candidate-toolchain";

/** Process-owner functions, not a registration or permission received over RPC. */
export const installedGameProductionAPI={installedGameProductionVersion:1 as const,installedCoreGameProjectVersion:1 as const,installedCoreGameQueueVersion:1 as const,installedCoreGameMediaVersion:1 as const,installedCoreGameValidationVersion:1 as const,installedCoreGameValidationPortVersion:1 as const,installedCoreGameBrowserComponentVersion:1 as const,
  gameMediaProcessRequest,gameMediaProcessResult,assetSourceInputs,gameMediaToolchain,coreMediaSchemas:installedCoreGameMediaSchemas,
  gameBrowserProcessRequest,gameBrowserProcessResult,gameBrowserCandidateToolchain,coreValidationSchemas:installedCoreGameValidationSchemas,
  GameProductionFailure,GameProductionUncertain,gameContentHash,gameWebCompileRequest,gameWebCompileResult,coreBuildSchemas:installedCoreGameBuildSchemas};
