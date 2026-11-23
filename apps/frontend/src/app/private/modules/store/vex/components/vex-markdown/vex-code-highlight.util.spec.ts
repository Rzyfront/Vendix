import { highlightCode, normalizeCodeLang } from './vex-code-highlight.util';

const kinds = (code: string, lang: string) =>
  highlightCode(code, lang).filter((token) => token.kind !== 'plain');

describe('highlightCode (code blocks in Vex answers)', () => {
  it('always gives back exactly the original text', () => {
    const samples: [string, string][] = [
      ['SELECT name, total FROM orders WHERE total > 100 -- big ones', 'sql'],
      ['const a = "x"; // note\nreturn a + 1;', 'ts'],
      ['{"ok": true, "n": 3.5}', 'json'],
      ['plain words, no language', ''],
    ];
    for (const [code, lang] of samples) {
      expect(highlightCode(code, lang).map((token) => token.text).join('')).toBe(code);
    }
  });

  it('marks SQL keywords in any case, numbers and the trailing comment', () => {
    expect(kinds('select id FROM orders where total > 100 -- nota', 'sql')).toEqual([
      { text: 'select', kind: 'keyword' },
      { text: 'FROM', kind: 'keyword' },
      { text: 'where', kind: 'keyword' },
      { text: '100', kind: 'number' },
      { text: '-- nota', kind: 'comment' },
    ]);
  });

  it('does not colour a keyword that sits inside a string or a comment', () => {
    expect(kinds('const a = "return if"; // return', 'ts')).toEqual([
      { text: 'const', kind: 'keyword' },
      { text: '"return if"', kind: 'string' },
      { text: '// return', kind: 'comment' },
    ]);
  });

  it('treats `#` as a comment only in languages that use it', () => {
    expect(kinds('# setup\nx = 1', 'python')[0]).toEqual({ text: '# setup', kind: 'comment' });
    expect(kinds('this.#secret = 1', 'js').some((token) => token.kind === 'comment')).toBe(false);
  });

  it('colours only strings, numbers and literals in JSON', () => {
    expect(kinds('{"type": "select", "ok": true}', 'json')).toEqual([
      { text: '"type"', kind: 'string' },
      { text: '"select"', kind: 'string' },
      { text: '"ok"', kind: 'string' },
      { text: 'true', kind: 'keyword' },
    ]);
  });

  it('leaves an unknown or missing language as one plain piece', () => {
    expect(highlightCode('select 1', 'brainfuck')).toEqual([{ text: 'select 1', kind: 'plain' }]);
    expect(highlightCode('select 1', null)).toEqual([{ text: 'select 1', kind: 'plain' }]);
    expect(highlightCode('', 'sql')).toEqual([]);
  });

  it('normalizes the fence language', () => {
    expect(normalizeCodeLang(' TS title="a" ')).toBe('ts');
    expect(normalizeCodeLang(undefined)).toBe('');
  });
});
