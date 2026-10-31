# Releasing archdiag

Merging to `main` releases. The version in `package.json` is the single source of truth:
`.github/workflows/publish.yml` runs on every push to `main` and, if that version isn't on npm yet, runs the layout
checks, publishes it to npm, and creates the tag `v<version>` and a GitHub release with the package tarball attached.
If the version is already on npm (a docs-only merge, say), nothing is published.

Publishing uses npm trusted publishing (OIDC), so no npm token is stored in GitHub, and npm adds a provenance
statement to every version (a signed record of the commit and workflow that built it).

## Every release

1. On your branch, bump the version:
   ```bash
   npm version prerelease --preid=beta --no-git-tag-version   # 0.1.0-beta.0 -> 0.1.0-beta.1
   # or: npm version 0.1.0 --no-git-tag-version                # first stable
   # or: npm version patch|minor|major --no-git-tag-version
   ```
2. Open the pull request. CI's **release-preview** check says what merging will do, for example
   "Merging will publish archdiag@0.1.0-beta.1 to npm (dist-tag "beta") and create release v0.1.0-beta.1", or that
   the version is already on npm and nothing will be published. It fails if the version is invalid or lower than
   what's on npm.
3. Merge. The **Release** workflow does the rest; its run summary says what it did.

Versions with a suffix go to the npm dist-tag named after it (`0.1.0-beta.1` → `beta`, installed with
`npm install archdiag@beta`) and get a GitHub pre-release; plain versions go to `latest`.

If a release run fails part-way (say npm published but the GitHub release step didn't run), re-run it from the
Actions tab (**Release → Run workflow**): finished steps are skipped.

## One-time setup

npm configures trusted publishing per package, so the package had to exist before the workflow could publish it.
Done for archdiag: `0.1.0-beta.0` was published by hand on 2026-10-30.

**Connect the workflow** on npmjs.com: package `archdiag` → **Settings → Trusted publishing → GitHub Actions**:
- Organization or user: `dfbernal`
- Repository: `archdiag`
- Workflow filename: `publish.yml` (the file's name, not its display name, so don't rename the file)
- Environment: leave empty

Or from the command line (npm 11.10 or later):
`npm trust github archdiag --file publish.yml --repo dfbernal/archdiag --allow-publish`.

**Optional, recommended:** in the package settings, require two-factor authentication and disallow tokens for
publishing, so only the workflow can publish.

If a publish fails with `E404 Not Found`, the trusted publisher settings don't exactly match the repository and
workflow file name.

## Licences

archdiag bundles a patched libavoid (LGPL-2.1-or-later) and the Inter font (SIL OFL 1.1); see
`THIRD-PARTY-NOTICES.md`. When distributing, keep `vendor/libavoid-js/LICENSE`, `patches/` and
`vendor/libavoid-js/PATCHED.md` in the package (they are listed in `files` in `package.json`).
