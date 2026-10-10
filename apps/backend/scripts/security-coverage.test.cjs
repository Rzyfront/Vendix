const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const appRequire = createRequire(path.join(__dirname, '../package.json'));
const { loadNycConfig } = appRequire('@istanbuljs/load-nyc-config');

test('standalone backend coverage loader preserves JSON/YAML types and rejects JS tags', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vendix-coverage-contract-'));
  const config = { all: true, lines: 80, include: ['src/**/*.ts'], extension: ['.ts'] };
  try {
    fs.writeFileSync(path.join(directory, 'package.json'), '{"private":true}');
    fs.writeFileSync(path.join(directory, '.nycrc.json'), JSON.stringify(config));
    fs.writeFileSync(path.join(directory, '.nycrc.yaml'),
      'all: true\nlines: 80\ninclude:\n  - src/**/*.ts\nextension:\n  - .ts\n');
    const json = await loadNycConfig({ cwd: directory, nycrcPath: '.nycrc.json' });
    const yaml = await loadNycConfig({ cwd: directory, nycrcPath: '.nycrc.yaml' });
    assert.deepEqual(yaml, json);
    assert.deepEqual(yaml, { cwd: directory, ...config });
    fs.writeFileSync(path.join(directory, '.nycrc.yaml'), 'value: !!js/function "function () {}"');
    await assert.rejects(loadNycConfig({ cwd: directory, nycrcPath: '.nycrc.yaml' }));
    fs.writeFileSync(path.join(directory, '.nycrc.yaml'), 'include: [unterminated');
    await assert.rejects(loadNycConfig({ cwd: directory, nycrcPath: '.nycrc.yaml' }));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
