# Release and recovery

Voice Capture Studio is deployed from `main` only after the complete validation
and multi-browser test matrix passes. Every successful `main` run retains three
immutable files under the commit SHA for 30 days:

- the exact static `dist/` tree as a compressed archive;
- its SHA-256 checksum;
- a CycloneDX 1.5 software bill of materials generated from the lockfile.

These files are recovery evidence, not a second deployment path. GitHub Pages
continues to build from reviewed source so the public site and repository never
silently diverge.

## Verify a retained build

1. Open the successful CI run for the target commit and download
   `release-evidence-<commit_sha>`.
2. Run `sha256sum -c voice-capture-studio-<commit_sha>.tar.gz.sha256` from the
   extracted artifact directory.
3. Unpack the archive into a new temporary directory and serve that directory
   locally over HTTP. Never unpack it over a working tree or a live deployment.
4. Verify the opening ritual, one recording, replay, workspace archive restore,
   dataset export, offline restart, and the public base path before considering
   the build a recovery candidate.

## Roll back GitHub Pages

1. Identify the last known-good commit from a successful CI and Pages pair.
2. Revert only the bad delivery commits on `main` with new revert commits. Do
   not rewrite published history or force-push.
3. Push the revert and require both CI and Pages to finish successfully.
4. Compare the deployed asset hashes and opening flow with the new commit, then
   record the incident and the recovery commit.

The retained archive proves what the earlier build contained; the revert keeps
the normal source-to-deployment chain intact. A production rollback rehearsal
and physical-device acceptance remain explicit release exercises rather than
claims established by this document.
