# Third-party notices

archdiag itself is MIT-licensed (see `LICENSE`). It includes the following third-party components in its package,
which keep their own licences.

## libavoid / libavoid-js (patched)

- Location: `vendor/libavoid-js/`
- Licence: GNU Lesser General Public License, version 2.1 or later (`vendor/libavoid-js/LICENSE`)
- Upstream: libavoid from Adaptagrams (https://github.com/mjwybrow/adaptagrams), built for JavaScript by
  libavoid-js (https://github.com/Aksem/libavoid-js), branch `new-emsdk-and-embind` at commit `a7c3926`,
  Adaptagrams fork https://github.com/Aksem/adaptagrams at tag `v1.0.5`.
- Modifications: the two patches in `patches/` (ClusterRef bindings; pin connection costs applied at the target end
  of a connector). Sources and rebuild steps: `vendor/libavoid-js/PATCHED.md`.
- The library is a separate file loaded at run time (`vendor/libavoid-js/dist/`); it can be replaced with another
  build of libavoid-js.

## Inter typeface

- Location: `fonts/`
- Licence: SIL Open Font License 1.1 (`fonts/LICENSE-Inter.txt`)
- Upstream: https://github.com/rsms/inter

## Dependencies installed from npm (not bundled)

These are installed by npm under their own licences: elkjs (EPL-2.0 or GPL-3.0-or-later), @resvg/resvg-js (MPL-2.0),
js-yaml (MIT), opentype.js (MIT).
