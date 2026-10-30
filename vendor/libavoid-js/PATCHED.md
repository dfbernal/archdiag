# Patched build of libavoid-js (LGPL-2.1, see LICENSE)

Built 2026-10-30 from Aksem/libavoid-js branch `new-emsdk-and-embind` (commit a7c3926) with emsdk 4.0.7, plus:

- `../../patches/0001-Add-ClusterRef-bindings-and-Router.deleteCluster.patch` (libavoid-js)
- `../../patches/0001-libavoid-apply-pin-connection-cost-at-the-target-end.patch` (Aksem/adaptagrams v1.0.5)

Only the Node build is kept here (`dist/index-node.mjs` + `dist/libavoid.wasm`). How to rebuild: CONTEXT.md §5.
archdiag loads it by relative path (src/route.js), so it isn't an npm dependency and installs from git,
a folder or a registry all work the same.
