#!/usr/bin/env bash
# CI-only clean installs. Never invoke this on the RAM-constrained development Mac.
set -euo pipefail
revision=$1
app=$2
layout=$3
case "$revision:$app:$layout" in
  baseline:backend:workspace|baseline:frontend:workspace|candidate:backend:workspace|candidate:frontend:workspace|baseline:backend:standalone|baseline:frontend:standalone|candidate:backend:standalone|candidate:frontend:standalone) ;;
  *) echo 'Invalid CI installation target' >&2; exit 2 ;;
esac
source_root=$PWD
if [[ "$revision" == baseline ]]; then source_root=$PWD/baseline; fi
if [[ "$layout" == workspace ]]; then
  (cd "$source_root" && npm ci --ignore-scripts --legacy-peer-deps --workspace "apps/$app" --include-workspace-root=false --no-audit --no-fund)
  app_dir=$source_root/apps/$app
else
  stage=$RUNNER_TEMP/security-$revision-$app
  mkdir -p "$stage/apps"
  cp -R "$source_root/apps/$app" "$stage/apps/$app"
  app_dir=$stage/apps/$app
  if [[ "$app" == frontend ]]; then
    # This alias already exists in frontend tsconfig; no app-source changes.
    mkdir -p "$stage/apps/backend/src/common"
    cp -R "$source_root/apps/backend/src/common/money-kernel" "$stage/apps/backend/src/common/"
    # Frontend's existing peer policy is required for compatibility testing.
    # A separate STRICT job verifies Docker defaults and exposes that pending debt.
    npm --prefix "$app_dir" ci --workspaces=false --legacy-peer-deps --ignore-scripts --no-audit --no-fund
    ln -s "$app_dir/node_modules" "$stage/node_modules"
  else
    npm --prefix "$app_dir" ci --workspaces=false --legacy-peer-deps=false --ignore-scripts --no-audit --no-fund
  fi
fi
if [[ "$revision" == baseline ]]; then
  echo "BASELINE_APP=$app_dir" >> "$GITHUB_ENV"
else
  echo "CANDIDATE_APP=$app_dir" >> "$GITHUB_ENV"
fi
