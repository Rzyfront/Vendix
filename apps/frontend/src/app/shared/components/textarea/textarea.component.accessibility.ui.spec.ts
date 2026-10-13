import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'textarea.component.ts'), 'utf8');

describe('TextareaComponent accessible help and validation source guards', () => {
  it('exposes required state and associates validation errors without naming the decorative marker', () => {
    expect(source).toContain('[attr.aria-required]="required() ? \'true\' : null"');
    expect(source).toMatch(/aria-hidden="true"\s*>\s*\*\s*<\/span>/);
    expect(source).toContain('aria-invalid]="!!getValidationError()"');
    expect(source).toContain('[attr.aria-describedby]="getValidationError() ? errorId : null"');
    expect(source).toContain('[id]="errorId"');
    expect(source).toContain('role="alert"');
  });

  it('keeps the semantic help button outside the label without changing original spacing or icon geometry', () => {
    expect(source).toContain("<div [class]=\"labelClasses + ' label-with-tooltip'\">");
    expect(source).toMatch(/<label \[for\]="textareaId"[\s\S]*?<\/label>\s*@if \(tooltipText\(\)\) \{\s*<app-tooltip/);
    expect(source).toMatch(/<button\s+type="button"\s+class="help-icon"/);
    expect(source).toContain('[attr.aria-label]="\'Ayuda para \' + label()"');
    expect(source).toContain("const baseClasses = ['block', 'font-medium', 'mb-2'];");
    expect(source).toContain('.label-with-tooltip label {\n      margin-bottom: 0;');
    expect(source).toContain('padding: 0;\n      border: 0;\n      background: none;');
    expect(source).toContain('line-height: 0;');
    expect(source).toContain('<app-icon name="help-circle" [size]="14">');
    expect(source).not.toContain('h-11 w-11');
  });

  it('preserves validation borders and error backgrounds while respecting reduced motion', () => {
    expect(source).toContain("'border-[var(--color-destructive)]'");
    expect(source).toContain("'bg-[rgba(var(--color-error-rgb),0.05)]'");
    expect(source).toContain('@media (prefers-reduced-motion: reduce)');
    expect(source).toContain('transition: none;');
  });
});
