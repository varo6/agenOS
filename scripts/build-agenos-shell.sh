#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUST_DIR="${ROOT_DIR}/tools/agenos-shell-rust"
TARGET_DIR="${ROOT_DIR}/build/live-build/config/includes.chroot/usr/local"

echo "Building agenos-shell-rust..."
cargo build --release --manifest-path "${RUST_DIR}/Cargo.toml"

echo "Stripping binaries..."
strip "${RUST_DIR}/target/release/server" "${RUST_DIR}/target/release/helper" "${RUST_DIR}/target/release/emergency"

echo "Copying binaries to live-build chroot..."
mkdir -p "${TARGET_DIR}/bin" "${TARGET_DIR}/lib/agenos-shell"

cp "${RUST_DIR}/target/release/server" "${TARGET_DIR}/lib/agenos-shell/server"
cp "${RUST_DIR}/target/release/emergency" "${TARGET_DIR}/lib/agenos-shell/emergency"
cp "${RUST_DIR}/target/release/helper" "${TARGET_DIR}/bin/agenos-shell-helper"
chmod 0755 \
  "${TARGET_DIR}/lib/agenos-shell/server" \
  "${TARGET_DIR}/lib/agenos-shell/emergency" \
  "${TARGET_DIR}/bin/agenos-shell-helper"

echo "Removing old Python files..."
rm -f "${TARGET_DIR}/lib/agenos-shell/server.py"
rm -f "${TARGET_DIR}/lib/agenos-shell/emergency.py"

echo "Done building and replacing agenos-shell."
