// What would a merge to main release? Shared by the CI preview (pull requests) and the release workflow (main).
//
//   node .github/scripts/release-plan.mjs [--github-output]
//
// Reads the version from package.json and compares it with what's on npm. Prints key=value lines
// (and appends them to $GITHUB_OUTPUT with --github-output):
//   version, tag (v<version>), dist_tag (prerelease id, e.g. "beta", or "latest"), prerelease (true|false),
//   published (already on npm), highest (highest version on npm), newer (version > highest),
//   action: publish | skip | error
//   message: one human-readable line
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

// Semver precedence (https://semver.org/#spec-item-11), enough for x.y.z and x.y.z-pre.n versions.
const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
const parse = (v) => {
  const m = SEMVER.exec(v);
  return m && { core: [+m[1], +m[2], +m[3]], pre: m[4] ? m[4].split('.') : [] };
};
function compare(a, b) {
  const A = parse(a), B = parse(b);
  for (let i = 0; i < 3; i++) if (A.core[i] !== B.core[i]) return A.core[i] - B.core[i];
  if (!A.pre.length || !B.pre.length) return B.pre.length - A.pre.length;   // a release outranks its prereleases
  for (let i = 0; i < Math.max(A.pre.length, B.pre.length); i++) {
    const x = A.pre[i], y = B.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) { if (+x !== +y) return +x - +y; }
    else if (nx !== ny) return nx ? -1 : 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

const { name, version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const out = { version, tag: `v${version}` };

if (!parse(version)) {
  Object.assign(out, { action: 'error', message: `package.json version "${version}" is not a valid semver version` });
} else {
  let onNpm = [];
  try {
    const json = execFileSync('npm', ['view', name, 'versions', '--json'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    onNpm = [].concat(JSON.parse(json));
  } catch { onNpm = []; }   // E404: the package isn't on npm yet
  // npm's own placeholder for staged publishing isn't a real version.
  onNpm = onNpm.filter((v) => parse(v) && !/^0\.0\.0-stage/.test(v));
  const highest = onNpm.reduce((h, v) => (h === null || compare(v, h) > 0 ? v : h), null);
  const pre = parse(version).pre;
  const published = onNpm.includes(version);
  const newer = highest === null || compare(version, highest) > 0;
  Object.assign(out, {
    dist_tag: pre.length ? (/^\d+$/.test(pre[0]) ? 'next' : pre[0]) : 'latest',
    prerelease: String(pre.length > 0),
    published: String(published),
    highest: highest ?? '',
    newer: String(newer),
  });
  if (published) {
    Object.assign(out, { action: 'skip', message: `${name}@${version} is already on npm, so merging won't publish. To release, bump the version (e.g. npm version prerelease --preid=beta --no-git-tag-version).` });
  } else if (!newer) {
    Object.assign(out, { action: 'error', message: `${name}@${version} is lower than the highest version on npm (${highest}). Bump it above ${highest}.` });
  } else {
    Object.assign(out, { action: 'publish', message: `Merging will publish ${name}@${version} to npm (dist-tag "${out.dist_tag}") and create release ${out.tag}.` });
  }
}

const lines = Object.entries(out).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
process.stdout.write(lines);
if (process.argv.includes('--github-output') && process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, lines);
