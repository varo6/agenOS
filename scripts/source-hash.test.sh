#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/source-hash.sh"
task_dir="$(mktemp -d)"
trap 'rm -rf "${task_dir}"' EXIT
mkdir -p "${task_dir}/src" "${task_dir}/node_modules/dependency"
echo first > "${task_dir}/src/a file.ts"
before="$(hash_sources "${task_dir}" src node_modules missing.lock)"
echo test > "${task_dir}/src/file.test.js"
echo dependency > "${task_dir}/node_modules/dependency/file.js"
[[ "${before}" == "$(hash_sources "${task_dir}" src node_modules missing.lock)" ]]
echo changed > "${task_dir}/src/a file.ts"
[[ "${before}" != "$(hash_sources "${task_dir}" src node_modules missing.lock)" ]]
[[ -z "$(hash_sources "${task_dir}" absent)" ]]
echo 'source-hash: OK'
