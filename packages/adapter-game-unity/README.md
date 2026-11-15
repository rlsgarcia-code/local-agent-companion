# Unity production adapter source

Inactive integration under development. The editor preparation, strict native
project preflight, pinned built-in module metadata and controlled C# web exporter
and independent candidate inspection are separate from license, OS isolation and production registration.

Read [the project/export contract](../../docs/GAME_UNITY_PROJECTS.md),
[toolchain qualification](../../docs/GAME_UNITY_QUALIFICATION.md) and the
[full Game Design plan](../../docs/GAME_DESIGN_IMPLEMENTATION_PLAN.md).

`src/project.ts` accepts only authenticated revision data through its caller.
It performs no writes, editor invocation, migration or authority decisions.
`editor/CompanionWebBuild.cs` has compiled against the pinned LTS references;
that does not prove an editor import, 2D/3D build, playable game or license.

`src/output.ts` reads candidate TAR/diagnostics/UnityWebData tables without
executing HTML/JS/WASM or extracting files. Its bounded result is not a player,
process-owner receipt or QA. Keep original names/bytes and explicit refusals.

The engine may ship driver/lock **source** and the pure inspector bundle without
registering Unity. Never
enable this package from a `prepared-unqualified` inventory or call the editor
outside its future qualified broker. KidOS integration belongs to Core/Root,
not generic workspace, shell or Docker capabilities.

`src/player.ts` prepares an explicit **unqualified** player candidate, with
external shell/config/CSS, complete bounded notice bytes and normal Unity
instance lifecycle. It reinspects the raw export; the original private TAR
must be retained by the caller. Read [player contract and limits](../../docs/GAME_UNITY_PLAYER.md).
A simulated API/minimum WASM qualification does not enable real Unity production.
