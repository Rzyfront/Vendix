import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'selector.component.ts'), 'utf8');
const styles = readFileSync(join(__dirname, 'selector.component.scss'), 'utf8');

describe('SelectorComponent accessible help source guards', () => {
  it('keeps the help button outside the associated label with a contextual name', () => {
    expect(source).toContain("<div [class]=\"labelClasses + ' label-with-tooltip'\">");
    expect(source).toContain('<label [class]="labelClasses + \' !mb-0\'" [for]="id()">');
    expect(source).toContain('</label>\n          @if (tooltipText()) {');
    expect(source).toMatch(/<button\s+type="button"\s+class="help-icon"/);
    expect(source).toContain('[attr.aria-label]="\'Ayuda para \' + label()"');
    expect(source).toContain('[attr.aria-required]="required() ? \'true\' : null"');
    expect(source).toContain('aria-hidden="true">*</span>');
  });

  it('retains original help geometry and label spacing alongside the existing focus ring', () => {
    expect(source).toContain("const baseClasses = ['block', 'font-medium', 'mb-2'];");
    expect(styles).toContain('padding: 0;\n  border: 0;\n  background: none;');
    expect(styles).toContain('line-height: 0;');
    expect(source).toContain('<app-icon name="help-circle" [size]="14">');
    expect(source).not.toContain('h-11 w-11');
    expect(source).toContain('focus:ring-[var(--color-ring)]');
  });

  it('disables selector motion when reduced motion is requested', () => {
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.selector-select[\s\S]*?transition:\s*none;/);
  });
});
