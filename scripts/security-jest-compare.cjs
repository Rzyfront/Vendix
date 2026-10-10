// Compare all shards together: sharding may assign paths differently across checkouts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const directory = process.argv[2];
const layout = process.argv[3];
const files = fs.readdirSync(directory, { recursive: true }).filter((file) => file.endsWith('.json'));
function collect(revision) {
  const selected = files.filter((file) => path.basename(file).startsWith(`${layout}-${revision}-`));
  assert.equal(selected.length, 8, 'Missing shard reports: ' + revision);
  const suites = new Map();
  for (const file of selected) {
    const report = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));
    assert.ok(report.testResults?.length, 'Incomplete Jest report: ' + file);
    assert.equal(report.wasInterrupted, false, 'Interrupted shard: ' + file);
    for (const suite of report.testResults) {
      const name = suite.name.split('/src/').at(-1);
      assert.ok(!suites.has(name), 'Duplicate suite across shards: ' + name);
      suites.set(name, suite);
    }
  }
  return suites;
}
const baseline = collect('baseline');
const candidate = collect('candidate');
function failureFingerprint(test) {
  return (test.failureMessages || []).map((message) => message
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split('\n').filter((line) => !/^\s+at\s/.test(line)).join('\n')
    .replace(/(?:\/[\w.@-]+)+(\/(?:src|node_modules)\/)/g, '$1')).join('\n');
}
const existing = [];
const regressions = [];
for (const name of baseline.keys()) if (!candidate.has(name)) regressions.push('Missing suite: ' + name);
for (const [name, suite] of candidate) {
  const previous = baseline.get(name);
  if (suite.status === 'failed' && !suite.assertionResults.length) {
    regressions.push('No executed assertions (coverage incomplete): ' + name);
  }
  const oldTests = new Map((previous?.assertionResults || []).map((test) => [test.fullName, test]));
  const newTests = new Set(suite.assertionResults.map((test) => test.fullName));
  for (const test of oldTests.keys()) if (!newTests.has(test)) regressions.push(`Missing test: ${name}: ${test}`);
  for (const test of suite.assertionResults) {
    const identity = `${name}: ${test.fullName}`;
    if (test.status === 'failed') {
      if (oldTests.get(test.fullName)?.status === 'failed' &&
          failureFingerprint(oldTests.get(test.fullName)) === failureFingerprint(test)) existing.push(identity);
      else regressions.push(identity);
    } else if (test.status !== 'passed' && oldTests.get(test.fullName)?.status !== test.status) {
      regressions.push('New skipped/pending test: ' + identity);
    }
  }
}
const summary = `### Backend security comparison (${layout})\n` +
  `Baseline suites: ${baseline.size}; candidate suites: ${candidate.size}\n\n` +
  `Pre-existing failures: ${existing.length}. New/incomplete results: ${regressions.length}.\n` +
  (existing.length ? '\n**Baseline remains RED; this is NOT a full test PASS.**\n' : '') +
  existing.map((value) => '- Pre-existing: ' + value).join('\n') + '\n' +
  regressions.map((value) => '- BLOCKING: ' + value).join('\n') + '\n';
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
assert.equal(regressions.length, 0, 'New regression or incomplete coverage blocks release');
