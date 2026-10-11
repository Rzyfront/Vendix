import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'input.component.ts'), 'utf8');

describe('InputComponent accessible help and password controls source guards', () => {
  it('keeps the help trigger semantic and outside the associated label', () => {
    expect(source).toContain('<div class="label-with-tooltip">');
    expect(source).toContain('<label [for]="inputId()" [class]="labelClasses">');
    expect(source).toContain('class="help-icon inline-flex h-11 w-11');
    expect(source).toContain('[attr.aria-label]="\'Ayuda para \' + label()"');
    expect(source).toContain('focus-visible:outline-[var(--color-text-primary)]');
    expect(source).toContain('</label>\n          @if (tooltipText()) {');
    expect(source).toContain('[attr.aria-required]="required() ? \'true\' : null"');
    expect(source).toContain('aria-hidden="true">*</span>');
    expect(source).toContain('focus-visible:outline-offset-2');
    expect(source).toContain("'focus-visible:outline-[var(--color-text-primary)]'");
    expect(source).toContain('mt-2 text-sm text-[var(--color-text-primary)]');
    expect(source).toContain('border-[var(--color-destructive)]');
    expect(source).toContain('text-[var(--color-text-primary)]');
    expect(source).toContain('color: var(--color-text-primary);');
    expect(source).toContain("'text-[var(--color-text-primary)]'");
    expect(source).toContain("'placeholder:text-[var(--color-text-primary)]'");
  });

  it('keeps password reveal keyboard-native, disabled-aware, announced, and padded', () => {
    expect(source).toContain('[disabled]="isDisabled()"');
    expect(source).toContain('[attr.aria-pressed]="showPassword()"');
    expect(source).toContain('class="password-visibility-toggle absolute right-0 top-1/2 flex h-11 w-11');
    expect(source).toContain('text-[var(--color-text-primary)]');
    expect(source).toContain('focus-visible:outline-[var(--color-text-primary)]');
    expect(source).toContain("? ['pr-12']");
    expect(source).not.toContain('tabindex="-1"');
    expect(source).toContain('@media (prefers-reduced-motion: reduce)');
    expect(source).toContain('transition: none;');
  });
});
