// Cross-platform wrapper for `expo start` (no platform flag).
//
// Loads `apps/mobile/.env.web` via Node's --env-file flag (Node 20.6+),
// then spawns `expo start` with the merged environment. Without the
// `--web` flag, Expo shows the Dev Tools menu so the user can pick
// web / iOS / Android at runtime.
//
// Why this exists:
//   `expo start` (Expo SDK 54 / CLI 54.0.16) intermittently crashes with
//   `TypeError: Body is unusable: Body has already been read` during the
//   `expo:doctor:dependencies:bundledNativeModules` step. The fetch to
//   https://api.expo.dev/v2/sdks/54.0.0/native-modules consumes the response
//   body twice, and the second `response.json()` call throws an unhandled
//   error that kills the dev server with exit code 1.
//
//   Setting `EXPO_NO_DEPENDENCY_VALIDATION=1` short-circuits the doctor check
//   before the buggy fetch is reached, so the dev server stays up. The check
//   is non-essential for local development — `expo install --check` should
//   be used instead when actual version validation is needed.
//
// `npm run web` uses `scripts/web-dev.js` (the same wrapper but with
// `--web` appended). Keep both in sync if the dep-validation workaround
// ever changes.

const { spawn } = require('node:child_process');
const path = require('node:path');

const isWindows = process.platform === 'win32';
const expoBin = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'node_modules',
  '.bin',
  isWindows ? 'expo.cmd' : 'expo',
);

const args = process.argv.slice(2);
const child = spawn(expoBin, ['start', ...args], {
  stdio: 'inherit',
  env: process.env,
  shell: isWindows,
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});