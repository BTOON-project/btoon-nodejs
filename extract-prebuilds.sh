#!/bin/bash
set -e

echo "Extracting prebuilds for node-gyp-build..."

# Remove old extracted prebuilds
rm -rf prebuilds/linux-x64 prebuilds/linux-arm64 prebuilds/darwin-x64 prebuilds/darwin-arm64 prebuilds/win32-x64

# Extract each tar.gz to the correct location
for tarfile in prebuilds/*.tar.gz; do
    if [[ ! -f "$tarfile" ]]; then continue; fi
    
    filename=$(basename "$tarfile" .tar.gz)
    
    # Parse: btoon-v0.0.4-node-v127-linux-x64
    # Extract platform and arch
    platform=$(echo "$filename" | grep -o 'linux\|darwin\|win32')
    arch=$(echo "$filename" | grep -o 'x64\|arm64' | tail -1)
    abi=$(echo "$filename" | grep -o 'node-v[0-9]*' | sed 's/node-//')
    
    if [[ -z "$platform" || -z "$arch" ]]; then
        echo "Skipping $filename (couldn't parse platform/arch)"
        continue
    fi
    
    target_dir="prebuilds/${platform}-${arch}"
    mkdir -p "$target_dir"
    
    echo "Extracting $filename -> $target_dir/"
    tar -xzf "$tarfile" -C "$target_dir" --strip-components=2
    
    # Rename to node-gyp-build format: node.{abi}.node
    if [[ -f "$target_dir/btoon.node" ]]; then
        mv "$target_dir/btoon.node" "$target_dir/node.${abi}.node"
        echo "  ✓ Created $target_dir/node.${abi}.node"
    fi
done

echo ""
echo "✓ Prebuilds extracted successfully!"
echo "Structure:"
find prebuilds -name "*.node" -type f
