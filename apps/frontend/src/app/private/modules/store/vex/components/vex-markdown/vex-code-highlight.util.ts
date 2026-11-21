/** Visual role of a piece of code. */
export type VexCodeTokenKind = 'plain' | 'comment' | 'string' | 'number' | 'keyword';

export interface VexCodeToken {
  text: string;
  kind: VexCodeTokenKind;
}

/** Languages whose line comment starts with `#`. */
const HASH_COMMENT = new Set(['python', 'py', 'bash', 'sh', 'shell', 'zsh', 'yaml', 'yml', 'ruby', 'rb', 'toml', 'dockerfile']);
/** Languages whose line comment starts with `--`. */
const DASH_COMMENT = new Set(['sql', 'postgres', 'postgresql', 'mysql', 'lua']);
/** Languages whose line comment starts with `//` and that have block comments. */
const SLASH_COMMENT = new Set(['js', 'javascript', 'jsx', 'ts', 'typescript', 'tsx', 'java', 'c', 'cpp', 'csharp', 'cs', 'go', 'rust', 'rs', 'php', 'kotlin', 'swift', 'dart', 'scss', 'css', 'json5', 'jsonc']);
/** Data formats: strings and numbers only. */
const DATA = new Set(['json']);

const KEYWORDS = new Set([
  'abstract', 'and', 'as', 'async', 'await', 'begin', 'break', 'by', 'case', 'catch', 'class',
  'const', 'continue', 'create', 'def', 'default', 'delete', 'do', 'elif', 'else', 'end', 'enum',
  'except', 'export', 'extends', 'false', 'finally', 'fn', 'for', 'from', 'func', 'function',
  'group', 'having', 'if', 'implements', 'import', 'in', 'insert', 'interface', 'into', 'is',
  'join', 'lambda', 'left', 'let', 'limit', 'new', 'nil', 'none', 'not', 'null', 'of', 'on', 'or',
  'order', 'package', 'pass', 'private', 'protected', 'public', 'raise', 'readonly', 'return',
  'select', 'set', 'static', 'struct', 'super', 'switch', 'table', 'then', 'this', 'throw', 'true',
  'try', 'type', 'undefined', 'union', 'update', 'use', 'values', 'var', 'void', 'where', 'while',
  'with', 'yield',
]);

/** Normalized fence language (`TS` → `ts`); empty when the fence named none. */
export function normalizeCodeLang(lang: string | null | undefined): string {
  return (lang ?? '').trim().toLowerCase().split(/\s+/)[0] ?? '';
}

function supported(lang: string): boolean {
  return (
    HASH_COMMENT.has(lang) || DASH_COMMENT.has(lang) || SLASH_COMMENT.has(lang) || DATA.has(lang)
  );
}

/**
 * Splits code into coloured pieces. Deliberately small: comments, strings,
 * numbers and common keywords of the languages a business owner is likely to
 * see (SQL, JSON, scripts). An unknown or missing language yields one plain
 * piece — never a wrong colouring. Joining every `text` gives back the input.
 */
export function highlightCode(code: string, lang: string | null | undefined): VexCodeToken[] {
  if (!code) return [];
  const language = normalizeCodeLang(lang);
  if (!supported(language)) return [{ text: code, kind: 'plain' }];

  const parts: string[] = [];
  if (SLASH_COMMENT.has(language)) parts.push('(?<comment>\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)');
  else if (HASH_COMMENT.has(language)) parts.push('(?<comment>#[^\\n]*)');
  else if (DASH_COMMENT.has(language)) parts.push('(?<comment>--[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)');
  parts.push('(?<string>"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\'|`(?:\\\\.|[^`\\\\])*`)');
  parts.push('(?<number>\\b\\d+(?:\\.\\d+)?\\b)');
  parts.push('(?<word>[A-Za-z_][A-Za-z0-9_]*)');
  const scanner = new RegExp(parts.join('|'), 'g');

  const tokens: VexCodeToken[] = [];
  const push = (text: string, kind: VexCodeTokenKind) => {
    if (!text) return;
    const last = tokens[tokens.length - 1];
    if (last && last.kind === kind) last.text += text;
    else tokens.push({ text, kind });
  };

  let cursor = 0;
  for (const match of code.matchAll(scanner)) {
    const index = match.index ?? 0;
    push(code.slice(cursor, index), 'plain');
    const groups = match.groups ?? {};
    if (groups['comment'] !== undefined) push(match[0], 'comment');
    else if (groups['string'] !== undefined) push(match[0], 'string');
    else if (groups['number'] !== undefined) push(match[0], 'number');
    else {
      const isKeyword = !DATA.has(language) && KEYWORDS.has(match[0].toLowerCase());
      const isLiteral = DATA.has(language) && ['true', 'false', 'null'].includes(match[0]);
      push(match[0], isKeyword || isLiteral ? 'keyword' : 'plain');
    }
    cursor = index + match[0].length;
  }
  push(code.slice(cursor), 'plain');
  return tokens;
}
