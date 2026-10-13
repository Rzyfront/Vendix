import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'input.component.ts'), 'utf8');

describe('InputComponent accessible help and password controls source guards', () => {
  it('keeps the help trigger semantic and outside the associated label', () => {
    expect(source).toContain("<div [class]=\"labelClasses + ' label-with-tooltip'\">");
    expect(source).toContain('<label [for]="inputId()" [class]="labelClasses">');
    expect(source).toMatch(/<button\s+type="button"\s+class="help-icon"/);
    expect(source).toContain('[attr.aria-label]="\'Ayuda para \' + label()"');
    expect(source).toContain('</label>\n          @if (tooltipText()) {');
    expect(source).toContain('[attr.aria-required]="required() ? \'true\' : null"');
    expect(source).toContain('aria-hidden="true">*</span>');
  });

  it('retains original label spacing, help geometry, control padding, and validation focus', () => {
    expect(source).toContain("const baseClasses = ['block', 'font-medium', 'mb-2'];");
    expect(source).toContain('.label-with-tooltip label {\n        margin-bottom: 0;');
    expect(source).toContain('padding: 0;\n        border: 0;\n        background: none;');
    expect(source).toContain('line-height: 0;');
    expect(source).toContain('<app-icon name="help-circle" [size]="14">');
    expect(source).not.toContain('h-11 w-11');
    expect(source).toContain("? ['pr-10']");
    expect(source).toContain("'focus:shadow-[0_0_0_2px_var(--color-ring)]'");
    expect(source).toContain("'bg-[rgba(239,68,68,0.1)]'");
    expect(source).toContain("'bg-[rgba(126,215,165,0.1)]'");
  });

  it('keeps password reveal keyboard-native, disabled-aware, announced, and reduced-motion aware', () => {
    expect(source).toContain('[disabled]="isDisabled()"');
    expect(source).toContain('[attr.aria-pressed]="showPassword()"');
    expect(source).toContain("showPassword() ? 'Ocultar contraseña' : 'Mostrar contraseña'");
    expect(source).toContain('class="password-visibility-toggle absolute inset-y-0 right-0 pr-3');
    expect(source).not.toContain('tabindex="-1"');
    expect(source).toContain('@media (prefers-reduced-motion: reduce)');
    expect(source).toContain('transition: none;');
  });
});
