#!/bin/bash
# Build and prepare BTOON Node.js library for release

set -e

echo "Building BTOON Node.js Library for Release"
echo "=========================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check Node.js version
NODE_VERSION=$(node -v)
echo "Node.js version: $NODE_VERSION"

# Clean previous builds
echo -e "\n${YELLOW}Cleaning previous builds...${NC}"
npm run clean

# Build the core library if needed
if [ ! -f "../btoon-core/build/libbtoon_core.a" ]; then
    echo -e "\n${YELLOW}Building btoon-core library...${NC}"
    cd ../btoon-core
    mkdir -p build && cd build
    cmake .. -DCMAKE_BUILD_TYPE=Release
    make -j$(nproc 2>/dev/null || sysctl -n hw.ncpu)
    cd ../../btoon-nodejs
fi

# Install dependencies
echo -e "\n${YELLOW}Installing dependencies...${NC}"
npm ci

# Build release version
echo -e "\n${YELLOW}Building release version...${NC}"
npm run build:release

# Run tests
echo -e "\n${YELLOW}Running tests...${NC}"
npm test

# Run quick test
echo -e "\n${YELLOW}Running quick test...${NC}"
npm run test:quick

# Build prebuilds for multiple Node versions
if command -v prebuild &> /dev/null; then
    echo -e "\n${YELLOW}Building prebuilds for distribution...${NC}"
    npm run prebuild
else
    echo -e "\n${YELLOW}Skipping prebuilds (prebuild not installed)${NC}"
fi

# Create tarball for distribution
echo -e "\n${YELLOW}Creating distribution package...${NC}"
npm pack

echo -e "\n${GREEN}✅ Release build completed successfully!${NC}"
echo "Package created: btoon-*.tgz"
echo ""
echo "To publish to npm:"
echo "  npm publish"
echo ""
echo "To test locally:"
echo "  npm install ./btoon-*.tgz"
