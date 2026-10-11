import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'textarea.component.ts'), 'utf8');

describe('TextareaComponent accessible foreground source guards', () => {
  it('uses text-primary for label, help, error, placeholder, and required marker while exposing required state', () => {
    expect(source).toContain("'text-[var(--color-text-primary)]'");
    expect(source).toContain('text-[var(--color-text-primary)]');
    expect(source).toContain("'placeholder:text-[var(--color-text-primary)]'");
    expect(source).toContain('[attr.aria-required]="required() ? \'true\' : null"');
    expect(source).toContain('aria-invalid]="!!getValidationError()"');
    expect(source).toContain('[attr.aria-describedby]="getValidationError() ? errorId : null"');
    expect(source).toContain('[id]="errorId"');
    expect(source).not.toContain('text-[var(--color-text-destructive)]');
    expect(source).not.toContain('text-[var(--color-text-secondary)]');
    expect(source).not.toContain('text-[var(--color-text-muted)]');
  });

  it('preserves validation borders and error backgrounds while respecting reduced motion', () => {
    expect(source).toContain("'border-[var(--color-destructive)]'");
    expect(source).toContain("'bg-[rgba(var(--color-error-rgb),0.05)]'");
    expect(source).toContain('@media (prefers-reduced-motion: reduce)');
    expect(source).toContain('transition: none;');
  });
});
