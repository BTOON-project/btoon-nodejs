#!/bin/bash
set -e

echo "Building Linux x64 prebuilt binaries using Docker..."

# Build Docker image for x64 architecture
docker build --platform linux/amd64 -f Dockerfile.build -t btoon-linux-builder-x64 .

# Create temporary container and copy prebuilds
echo "Extracting prebuilt binaries..."
docker create --name btoon-temp-x64 btoon-linux-builder-x64
docker cp btoon-temp-x64:/build/prebuilds ./prebuilds-linux-x64
docker rm btoon-temp-x64

# Move Linux prebuilds to main prebuilds directory
echo "Copying Linux x64 prebuilds to prebuilds/ directory..."
cp -v prebuilds-linux-x64/*.tar.gz prebuilds/ 2>/dev/null || true
rm -rf prebuilds-linux-x64

echo "✓ Linux prebuilt binaries built successfully!"
echo "Files in prebuilds/:"
ls -lh prebuilds/
