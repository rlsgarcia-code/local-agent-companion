# Offline licensed game libraries

Process-owner adapter for exact bundled asset groups, without inference, runtime
downloads, project-code execution or independent legal/artistic approval.

Read [the subsystem contract](../../docs/GAME_LICENSED_LIBRARIES.md) and
[the suite architecture](../../docs/SUITE_ARCHITECTURE.md).

Initial pack: Kenney Mini Arena 1.0, original public upstream revision
`a6927e66ff8dd8e173660ce4825abe773c65f683`. Original complete license and credits
are in [the asset notice](licenses/kenney-mini-arena-License.txt). The asset data
is declared CC0-1.0 by that notice; no upstream code/template is vendored.
`upstream.lock.json` pins each original path, size, Git blob ID and SHA-256.

`libraries/index.json` pins manifests; manifests pin original content-addressed
blobs and grouped dependencies/notices. `scripts/prepare-game-library.mjs` is
administrative and offline. The engine builder verifies and copies only that
closed inventory, with readable notices covered by the engine manifest.

The adapter is available only to Companion Mac/editor products in development.
KidOS requires a separately qualified protected catalog/Core contract. Existing
installed clients/releases are unchanged by these source files.
