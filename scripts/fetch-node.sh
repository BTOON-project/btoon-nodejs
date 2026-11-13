#!/usr/bin/env bash
# Downloads the official Node.js Linux build for this machine (x64 or arm64) from nodejs.org,
# checks it against the release's SHASUMS256.txt and unpacks it into DEST.
#
#   scripts/fetch-node.sh DEST [MAJOR]      # MAJOR defaults to 22; the newest release of it
#
# Used by the release workflow: in the manylinux_2_28 build image, which has no Node.js, and for
# the load tests in distro images without one. Needs curl, sha256sum and tar (with gzip).
set -euo pipefail

dest=${1:?usage: fetch-node.sh DEST [MAJOR]}
major=${2:-22}
case "$(uname -m)" in
  x86_64) arch=x64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) echo "fetch-node.sh: no official Node.js build for $(uname -m)" >&2; exit 1 ;;
esac

base="https://nodejs.org/dist/latest-v${major}.x"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL --retry 3 -o "$tmp/SHASUMS256.txt" "$base/SHASUMS256.txt"
file=$(awk -v suffix="-linux-$arch.tar.gz" 'substr($2, length($2) - length(suffix) + 1) == suffix { print $2 }' "$tmp/SHASUMS256.txt")
if [ -z "$file" ]; then
  echo "fetch-node.sh: no linux-$arch tarball listed in $base/SHASUMS256.txt" >&2
  exit 1
fi
curl -fsSL --retry 3 -o "$tmp/$file" "$base/$file"
(cd "$tmp" && grep "  $file\$" SHASUMS256.txt | sha256sum -c --quiet -)
mkdir -p "$dest"
tar -xzf "$tmp/$file" -C "$dest" --strip-components=1
"$dest/bin/node" --version
