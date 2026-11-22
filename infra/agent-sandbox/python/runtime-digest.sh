#!/bin/sh
# Prints the content identity of the analysis runtime (ANALYSIS_RUNTIME_DIGEST):
# sha256 over the sha256 manifest of every file that defines the image (pinned
# base in the Dockerfile, hashed lockfile and code). Same bytes -> same digest,
# on macOS (shasum) and Linux (sha256sum). Any change here re-opens T53.
set -eu
cd "$(dirname "$0")"
if command -v sha256sum >/dev/null 2>&1; then sum() { sha256sum "$@"; }; else sum() { shasum -a 256 "$@"; }; fi
sum Dockerfile requirements.txt handler.py runner.py | sum | awk '{print "sha256:" $1}'
