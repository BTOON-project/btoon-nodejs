# Releasing btoon (npm)

1. Point `core/` at a tagged btoon-core commit (`git -C core checkout vX.Y.Z && git add core`).
2. Bump `version` in `package.json` and `VERSION` in `index.js`, and update `CHANGELOG.md`.
3. Push tag `vX.Y.Z`. `.github/workflows/release.yml`:
   - builds Node-API prebuilds with prebuildify on Linux (glibc x64/arm64, musl x64),
     macOS (arm64 + x64) and Windows x64. The glibc ones are built in the manylinux_2_28
     images by `scripts/prebuild-linux.sh`, which fails if a binary needs more than
     glibc 2.28 (GLIBC 2.28, GLIBCXX 3.4.25, CXXABI 1.3.11; `scripts/check-glibc.sh`);
   - checks that each one loads and passes the tests;
   - packs the package and installs it, without install scripts, on Debian 11 and 12,
     Ubuntu 22.04, AlmaLinux 8, Amazon Linux 2023 (x64 and arm64) and Alpine (x64), where
     the prebuild has to load and round-trip (`scripts/load-test.sh`);
   - publishes with `npm publish --provenance`, using npm trusted publishing or the
     `NPM_TOKEN` secret.

   Run the workflow by hand (workflow_dispatch) to build and test without publishing. To
   reproduce a Linux build locally:
   `docker run --rm -v "$PWD:/work" -w /work quay.io/pypa/manylinux_2_28_aarch64 bash scripts/prebuild-linux.sh`.
4. Smoke-test with `npm i btoon@X.Y.Z && node -e "console.log(require('btoon').VERSION)"`.
