# Releasing btoon (npm)

1. Point `core/` at a tagged btoon-core commit (`git -C core checkout vX.Y.Z && git add core`).
2. Bump `version` in `package.json` and `VERSION` in `index.js`, and update `CHANGELOG.md`.
3. Push tag `vX.Y.Z`. `.github/workflows/release.yml`:
   - builds Node-API prebuilds with prebuildify on Linux (glibc x64/arm64, musl x64),
     macOS (arm64 + x64) and Windows x64;
   - checks that each one loads and passes the tests;
   - publishes with `npm publish --provenance`, using npm trusted publishing or the
     `NPM_TOKEN` secret.
4. Smoke-test with `npm i btoon@X.Y.Z && node -e "console.log(require('btoon').VERSION)"`.
