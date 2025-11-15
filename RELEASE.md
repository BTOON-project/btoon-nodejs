# BTOON Node.js Release Guide

## Prerequisites

1. **Build Tools**
   - Node.js >= 18.0.0
   - Python (for node-gyp)
   - C++ compiler (gcc/clang/MSVC)
   - CMake

2. **npm Account**
   - Register at https://www.npmjs.com
   - Run `npm login` to authenticate

3. **GitHub Access**
   - Push access to the repository
   - Personal access token for prebuild uploads

## Release Process

### 1. Prepare Release

```bash
# Update version in package.json
npm version patch  # or minor/major

# Build and test
make clean
make release
make test
```

### 2. Build for Distribution

```bash
# Build release version
./scripts/release.sh

# Or manually:
npm run build:release
npm run prebuild  # Create prebuilds for multiple Node versions
npm pack          # Create tarball
```

### 3. Test Package Locally

```bash
# Install locally
npm install ./btoon-*.tgz

# Test in another directory
cd /tmp
npm install /path/to/btoon-*.tgz
node -e "const btoon = require('btoon'); console.log(btoon.encode({test: true}))"
```

### 4. Publish to npm

```bash
# Dry run (check what will be published)
npm publish --dry-run

# Publish to npm
npm publish

# Or with Makefile
make publish
```

### 5. GitHub Release

1. Create a new release on GitHub
2. Tag with version (e.g., `v0.0.1`)
3. Upload prebuilt binaries
4. Add release notes

### 6. Verify Publication

```bash
# Check on npm
npm view btoon

# Install from npm
npm install btoon@latest
```

## Automated Release (CI/CD)

The GitHub Actions workflow (`.github/workflows/publish.yml`) automates:
- Building for multiple platforms
- Running tests
- Creating prebuilds
- Publishing to npm

To trigger:
1. Create a GitHub release
2. The workflow will automatically build and publish

## Platform Support

Current platforms:
- Linux x64, ARM64
- macOS x64, ARM64 (M1/M2)
- Windows x64

## Troubleshooting

### Build Errors
- Ensure btoon-core is built first
- Check CMake version (>= 3.10)
- Verify node-gyp installation

### Publishing Issues
- Check npm authentication: `npm whoami`
- Verify package name availability
- Ensure version is incremented

### Prebuild Issues
- Install prebuild tools: `npm install -g prebuild`
- Check GitHub token for uploads

## Version Management

Follow semantic versioning:
- **Patch** (0.0.x): Bug fixes, minor changes
- **Minor** (0.x.0): New features, backward compatible
- **Major** (x.0.0): Breaking changes

## Checklist

Before release:
- [ ] Tests pass
- [ ] Examples work
- [ ] Documentation updated
- [ ] CHANGELOG updated
- [ ] Version bumped
- [ ] Build succeeds on all platforms
- [ ] Local install test passes
