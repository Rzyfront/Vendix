const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const appRequire = createRequire(path.join(__dirname, '../package.json'));
const postcss = appRequire('postcss');
const tailwind = appRequire('tailwindcss');
const typography = appRequire('@tailwindcss/typography');
const tailwindRequire = createRequire(appRequire.resolve('tailwindcss/package.json'));
const nested = tailwindRequire('postcss-nested');

async function cssFixtures() {
  const nesting = await postcss([nested]).process(
    '.card { &[data-kind="x"] { color: red; } &:not(.off) > .child { color: blue; } }',
    { from: 'nesting.css', map: false },
  );
  const utility = await postcss([tailwind({
    darkMode: 'class',
    content: [{ raw: '<article class="prose md:block dark:text-white hover:bg-red-500 w-1/2 [&>a]:underline"></article>' }],
    plugins: [typography],
  })]).process('@tailwind components; @tailwind utilities;', { from: 'utilities.css', map: false });
  return { nesting: nesting.css, utility: utility.css };
}

if (process.argv[2] === '--snapshot') {
  cssFixtures().then((result) => fs.writeFileSync(process.argv[3], JSON.stringify(result, null, 2) + '\n'))
    .catch((error) => { console.error(error); process.exitCode = 1; });
} else {
  test('nesting, responsive, dark, escapes, attributes, :not and typography contracts', async () => {
    const result = await cssFixtures();
    assert.match(result.nesting, /\.card\[data-kind="x"\]/);
    assert.match(result.nesting, /\.card:not\(\.off\) > \.child/);
    assert.match(result.utility, /\.prose/);
    assert.match(result.utility, /min-width: 768px/);
    assert.match(result.utility, /dark/);
    assert.match(result.utility, /w-1\\\/2/);
    assert.match(result.utility, /text-decoration-line: underline/);
    if (process.env.SECURITY_CSS_BASELINE) {
      assert.deepEqual(result, JSON.parse(fs.readFileSync(process.env.SECURITY_CSS_BASELINE)),
        'CSS output changed relative to the pre-remediation baseline');
    }
  });

  test('PostCSS emits usable maps without fetching external source contents', async () => {
    const result = await postcss([nested]).process('.x { & > .y { color: red; } }', {
      from: 'fixture.css', to: 'output.css', map: { inline: false, sourcesContent: true },
    });
    const postcssRequire = createRequire(appRequire.resolve('postcss/package.json'));
    const { SourceMapConsumer } = postcssRequire('source-map-js');
    const map = result.map.toJSON();
    const consumer = new SourceMapConsumer(map);
    const original = consumer.originalPositionFor({ line: 1, column: 0 });
    assert.ok(original.source.endsWith('fixture.css'));
    assert.equal(consumer.sourceContentFor(original.source), '.x { & > .y { color: red; } }');
    const external = new SourceMapConsumer({ version: 3, sources: ['https://invalid.example/source.css'],
      names: [], mappings: 'AAAA' });
    assert.equal(external.sourceContentFor('https://invalid.example/source.css', true), null);
  });

  test('Angular CLI can load its scoped MCP SDK', () => {
    const cliRequire = createRequire(appRequire.resolve('@angular/cli/package.json'));
    assert.equal(typeof cliRequire('@modelcontextprotocol/sdk/server/mcp.js').McpServer, 'function');
  });
}

if (process.argv[2] !== '--snapshot') {
  test('each CSS consumer parses complex selectors with parser 7 contracts', () => {
    const selectors = '.a\\:b[data-kind="x"]:not(.off), :is(.x, .y) > .z';
    for (const parent of ['tailwindcss', 'postcss-nested', '@tailwindcss/typography']) {
      const parentRequire = parent === 'postcss-nested'
        ? createRequire(tailwindRequire.resolve('postcss-nested/package.json'))
        : createRequire(appRequire.resolve(parent + '/package.json'));
      const parser = parentRequire('postcss-selector-parser');
      assert.equal(parser().processSync(selectors), selectors);
      const ast = parser().astSync(selectors);
      let attributes = 0;
      ast.walkAttributes(() => { attributes += 1; });
      assert.equal(attributes, 1);
    }
  });

  test('bounded adversarial selector terminates in a child process', () => {
    const { spawnSync } = require('node:child_process');
    const parserPath = tailwindRequire.resolve('postcss-selector-parser');
    const source = `const parser = require(${JSON.stringify(parserPath)});
      const selectors = [':not('.repeat(32) + '.x' + ')'.repeat(32),
        '[data-x="' + 'x'.repeat(4096) + '"]', '.a\\\\:b'.repeat(512)];
      for (const selector of selectors) parser().astSync(selector);`;
    const child = spawnSync(process.execPath, ['--max-old-space-size=128', '-e', source], {
      timeout: 5000, maxBuffer: 64 * 1024, encoding: 'utf8',
    });
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr);
  });
}
