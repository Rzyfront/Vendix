// CI-only counterpart of the lock checker: inspect the installed consumer paths.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const [app, layout, directory] = process.argv.slice(2);
assert.ok(['backend', 'frontend'].includes(app));
assert.ok(['workspace', 'standalone'].includes(layout));
const appRequire = createRequire(path.resolve(directory, 'package.json'));
function consumerRequire(parent) { return createRequire(appRequire.resolve(parent + '/package.json')); }
function version(loader, entry, name) {
  let current = path.dirname(loader.resolve(entry));
  while (true) {
    const manifest = path.join(current, 'package.json');
    if (fs.existsSync(manifest)) {
      const metadata = JSON.parse(fs.readFileSync(manifest));
      if (metadata.name === name) return metadata.version;
    }
    const next = path.dirname(current);
    assert.notEqual(next, current, 'Cannot locate package metadata for ' + name);
    current = next;
  }
}
function expect(loader, entry, name, expected) {
  assert.equal(version(loader, entry, name), expected, `Unexpected installed ${name}`);
  console.log(`${app}/${layout}: ${name}=${expected}`);
}
if (app === 'backend') {
  expect(consumerRequire('express'), 'proxy-addr', 'proxy-addr', '2.0.8');
  expect(consumerRequire('@nestjs/swagger'), 'js-yaml', 'js-yaml', '5.4.1');
  expect(consumerRequire('@istanbuljs/load-nyc-config'), 'js-yaml', 'js-yaml',
    layout === 'standalone' ? '4.3.2' : '3.15.2');
} else {
  const cliRequire = consumerRequire('@angular/cli');
  expect(cliRequire, '@modelcontextprotocol/sdk/server/mcp.js', '@modelcontextprotocol/sdk', '1.31.0');
  const sdkRequire = createRequire(cliRequire.resolve('@modelcontextprotocol/sdk/server/mcp.js'));
  const expressRequire = createRequire(sdkRequire.resolve('express'));
  expect(expressRequire, 'proxy-addr', 'proxy-addr', '2.0.8');
  expect(appRequire, 'postcss', 'postcss', '8.5.28');
  expect(consumerRequire('postcss'), 'source-map-js', 'source-map-js', layout === 'standalone' ? '1.2.2' : '1.2.1');
  const tailwindRequire = consumerRequire('tailwindcss');
  for (const loader of [tailwindRequire, consumerRequire('@tailwindcss/typography'),
    createRequire(tailwindRequire.resolve('postcss-nested/package.json'))]) {
    expect(loader, 'postcss-selector-parser', 'postcss-selector-parser', '7.1.6');
  }
}
