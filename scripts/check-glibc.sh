#!/usr/bin/env bash
# Fails if a Linux glibc binary needs newer symbol versions than RHEL 8 / glibc 2.28 provides,
# the floor of Node.js's own Linux builds: GLIBC 2.28, GLIBCXX 3.4.25 and CXXABI 1.3.11 (the
# libstdc++ of GCC 8). A prebuild above it doesn't load on Debian 12, Ubuntu 22.04, RHEL 9,
# Amazon Linux 2023 or older, and npm then falls back to a source build.
#
#   scripts/check-glibc.sh prebuilds/linux-*/btoon.node
#
# Needs readelf (binutils). Reads the version needs (.gnu.version_r), which the loader checks.
set -euo pipefail

floor() {
  case $1 in
    GLIBC) echo 2.28 ;;
    GLIBCXX) echo 3.4.25 ;;
    CXXABI) echo 1.3.11 ;;
  esac
}
[ $# -gt 0 ] || { echo "usage: check-glibc.sh FILE..." >&2; exit 2; }
status=0
for file in "$@"; do
  needs=$(readelf --version-info --wide "$file" | sed -n '/Version needs section/,$p' |
    grep -oE '\b(GLIBC|GLIBCXX|CXXABI)_[0-9]+(\.[0-9]+)*\b' | sort -u || true)
  for family in GLIBC GLIBCXX CXXABI; do
    max=$(printf '%s\n' "$needs" | sed -n "s/^${family}_//p" | sort -V | tail -n 1)
    limit=$(floor "$family")
    if [ -z "$max" ]; then
      echo "$file: no ${family} symbols"
    elif [ "$(printf '%s\n%s\n' "$max" "$limit" | sort -V | tail -n 1)" = "$limit" ]; then
      echo "$file: ${family}_${max} (floor ${family}_${limit}): ok"
    else
      echo "::error file=${file}::needs ${family}_${max}, above the ${family}_${limit} floor (glibc 2.28, as Node.js's own Linux builds)"
      status=1
    fi
  done
done
exit "$status"
