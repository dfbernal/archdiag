# Patched build of libavoid-js (LGPL-2.1-or-later, see LICENSE)

This folder is a build of [libavoid-js](https://github.com/Aksem/libavoid-js) (the Adaptagrams libavoid router
compiled to WebAssembly) with two patches applied. Only the Node build is kept (`dist/index-node.mjs` and
`dist/libavoid.wasm`). archdiag loads it by relative path (`src/route.js`), so it isn't an npm dependency, and installs
from git, a folder or a registry all behave the same. Any other build of libavoid-js with the same API can replace it.

## Sources

- libavoid-js: https://github.com/Aksem/libavoid-js, branch `new-emsdk-and-embind`, commit `a7c3926`
- Adaptagrams (libavoid itself), as cloned by libavoid-js's build: https://github.com/Aksem/adaptagrams, tag `v1.0.5`
- Patches, in `../../patches/`:
  - `0001-Add-ClusterRef-bindings-and-Router.deleteCluster.patch` (applies to libavoid-js): exposes `ClusterRef`
    and `Router.deleteCluster` to JavaScript.
  - `0001-libavoid-apply-pin-connection-cost-at-the-target-end.patch` (applies to Adaptagrams): connection-pin
    costs were only applied at the source end of a connector; this applies them at the target end too.

## Rebuilding

Needs git, Python 3, Node and [emsdk](https://emscripten.org/docs/getting_started/downloads.html) 4.0.7 (libavoid-js's
`tools/generate.py` runs the same compiler through Docker image `emscripten/emsdk:4.0.7`; installing emsdk directly
gives the same result).

```bash
# Compiler
git clone https://github.com/emscripten-core/emsdk.git && cd emsdk
./emsdk install 4.0.7 && ./emsdk activate 4.0.7 && source ./emsdk_env.sh && cd ..

# Sources and patches
git clone https://github.com/Aksem/libavoid-js.git && cd libavoid-js
git checkout a7c3926
git apply /path/to/archdiag/patches/0001-Add-ClusterRef-bindings-and-Router.deleteCluster.patch
mkdir -p build && git clone https://github.com/Aksem/adaptagrams.git -b v1.0.5 build/adaptagrams
git -C build/adaptagrams apply /path/to/archdiag/patches/0001-libavoid-apply-pin-connection-cost-at-the-target-end.patch

# Compile (the emcc command from tools/generate.py, without the Docker wrapper), for the web and Node
SRC=""; for f in hyperedgeimprover geomtypes hyperedgetree makepath connend actioninfo connectionpin obstacle \
  junction shape hyperedge vertices mtst connector graph router geometry visibility uniqueid viscluster \
  orthogonal scanline vpsc; do SRC="$SRC ./build/adaptagrams/cola/libavoid/$f.cpp"; done
for env in web node; do
  mkdir -p build/dist_$env
  emcc -O3 -s ASSERTIONS=1 -flto -lembind -fwasm-exceptions --closure 1 -s LLD_REPORT_UNDEFINED -s FILESYSTEM=0 \
    -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORT_NAME="'initAvoidModule'" -s ENVIRONMENT="$env" \
    -s ABORT_ON_WASM_EXCEPTIONS=1 -s EXIT_RUNTIME=1 -s ALLOW_MEMORY_GROWTH=1 -s ALLOW_TABLE_GROWTH=1 \
    -Ibuild/adaptagrams/cola/ ./embind/bindings.cpp $SRC -o build/dist_$env/libavoid.js
done

# Bundle, as libavoid-js's own build does
mkdir -p src/generated
cp build/dist_web/libavoid.js build/dist_web/libavoid.wasm src/generated/
cp build/dist_node/libavoid.js src/generated/libavoid.mjs
npm install && node build.js

# Copy the Node build into archdiag
cp dist/index-node.mjs dist/index-node.d.ts dist/libavoid.wasm /path/to/archdiag/vendor/libavoid-js/dist/
```

The web and Node builds produce the same `libavoid.wasm`. Each compile takes about a minute and a half.
