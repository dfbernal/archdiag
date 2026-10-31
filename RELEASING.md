# Releasing archdiag

Releases are published to npm by `.github/workflows/publish.yml` when a GitHub release is published. It uses npm
trusted publishing (OIDC), so no npm token is stored in GitHub, and npm adds a provenance statement to every version
(a signed record of the commit and workflow that built it).

## Every release

1. Bump the version on a branch and merge it:
   ```bash
   npm version prerelease --preid=beta --no-git-tag-version   # 0.1.0-beta.0 -> 0.1.0-beta.1
   # or: npm version 0.1.0 --no-git-tag-version                # first stable
   ```
2. On GitHub: **Releases → Draft a new release**, create the tag `v<version>` (e.g. `v0.1.0-beta.1`) on `main`.
   Tick **Set as a pre-release** for beta versions. Publish the release.
3. The workflow then checks the tag matches `package.json`, runs `npm run check`, publishes to npm and attaches
   the package tarball to the release (the README's tarball install link points there).

Versions with a suffix go to the npm dist-tag named after it (`0.1.0-beta.1` → `beta`, installed with
`npm install archdiag@beta`); plain versions go to `latest`.

## One-time setup (before the first automated release)

npm configures trusted publishing per package, so the package has to exist before the workflow can publish it.

1. **Publish the first version by hand**, from a clean checkout of `main` at the release tag:
   ```bash
   npm login
   npm ci && npm run check
   npm publish --tag beta --access public
   ```
2. **Connect the workflow** on npmjs.com: package `archdiag` → **Settings → Trusted publishing → GitHub Actions**:
   - Organization or user: `dfbernal`
   - Repository: `archdiag`
   - Workflow filename: `publish.yml`
   - Environment: leave empty

   Or from the command line (npm 11.10 or later):
   `npm trust github archdiag --file publish.yml --repo dfbernal/archdiag --allow-publish`.
   npm expects the first publish through a new trusted publisher within 2 days of setting it up.
3. **Optional, recommended:** in the package settings, require two-factor authentication and disallow tokens for
   publishing, so only the workflow can publish.
4. **Create the GitHub release for that first version** (`v0.1.0-beta.0`, as a pre-release). The workflow sees the
   version is already on npm, skips publishing, and attaches the tarball to the release.

If a publish fails with `E404 Not Found`, the trusted publisher settings don't exactly match the repository and
workflow file name.

## Licences

archdiag bundles a patched libavoid (LGPL-2.1-or-later) and the Inter font (SIL OFL 1.1); see
`THIRD-PARTY-NOTICES.md`. When distributing, keep `vendor/libavoid-js/LICENSE`, `patches/` and
`vendor/libavoid-js/PATCHED.md` in the package (they are listed in `files` in `package.json`).
