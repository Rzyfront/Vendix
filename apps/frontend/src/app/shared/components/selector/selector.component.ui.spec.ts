import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'selector.component.ts'), 'utf8');
const styles = readFileSync(join(__dirname, 'selector.component.scss'), 'utf8');

describe('SelectorComponent accessible help source guards', () => {
  it('keeps the help button outside the associated label with a contextual name and focus style', () => {
    expect(source).toContain('<div class="label-with-tooltip">');
    expect(source).toContain('<label [class]="labelClasses + \' !mb-0\'" [for]="id()">');
    expect(source).toContain('</label>\n          @if (tooltipText()) {');
    expect(source).toContain('class="help-icon inline-flex h-11 w-11');
    expect(source).toContain('[attr.aria-label]="\'Ayuda para \' + label()"');
    expect(source).toContain('focus-visible:outline-[var(--color-text-primary)]');
    expect(styles).toContain('color: var(--color-text-primary);');
  });

  it('uses the high-contrast text token for labels, placeholders, helper copy, descriptions, and empty state', () => {
    expect(source).toContain("'text-[var(--color-text-primary)]'");
    expect(source).toContain("[style.color]=" + '"\'var(--color-text-primary)\'"');
    expect(source).toContain('text-xs text-[var(--color-text-primary)] truncate');
    expect(source).toContain('text-center text-sm text-[var(--color-text-primary)]');
    expect(source).toContain('class="text-text-primary"');
    expect(source).toContain('[attr.aria-required]="required() ? \'true\' : null"');
    expect(source).toContain('aria-hidden="true">*</span>');
    expect(source).toContain('focus-visible:outline-offset-2');
    expect(source).toContain("'focus-visible:outline-[var(--color-text-primary)]'");
    expect(source).toContain("'text-[var(--color-text-primary)]'");
    expect(source).toContain('text-[var(--color-text-primary)]\'].filter(Boolean).join(\' \')');
    expect(styles).toContain('.selector-placeholder {');
    expect(styles).toContain('color: var(--color-text-primary);');
    expect(styles).toContain('&.selector-placeholder-disabled {\n    color: var(--color-text-primary);\n    opacity: 0.6;');
  });

  it('disables selector motion when reduced motion is requested', () => {
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.selector-select[\s\S]*?transition:\s*none;/);
  });
});
