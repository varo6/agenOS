#!/usr/bin/env bash

# Huella de fuentes empaquetadas. Excluye dependencias instaladas y pruebas.
hash_sources() (
  cd "$1" || return
  shift
  local inputs=() path
  for path in "$@"; do
    [[ ! -e "${path}" ]] || inputs+=("${path}")
  done
  [[ ${#inputs[@]} -gt 0 ]] || return 0
  find "${inputs[@]}" -type d \( -name node_modules -o -name .git \) -prune -o \
    -type f ! -name '*.test.ts' ! -name '*.test.tsx' ! -name '*.test.js' ! -name '*.test.jsx' -print0 \
    | LC_ALL=C sort -z | xargs -0 -r sha256sum
)
