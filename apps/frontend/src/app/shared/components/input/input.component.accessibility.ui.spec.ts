import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'input.component.ts'), 'utf8');

describe('InputComponent accessible help and password controls source guards', () => {
  it('keeps the help trigger semantic and outside the associated label', () => {
    expect(source).toContain('<div class="label-with-tooltip">');
    expect(source).toContain('<label [for]="inputId()" [class]="labelClasses">');
    expect(source).toContain('class="help-icon inline-flex h-11 w-11');
    expect(source).toContain('[attr.aria-label]="\'Ayuda para \' + label()"');
    expect(source).toContain('focus-visible:ring-2');
    expect(source).toContain('</label>\n          @if (tooltipText()) {');
  });

  it('keeps password reveal keyboard-native, disabled-aware, announced, and padded', () => {
    expect(source).toContain('[disabled]="isDisabled()"');
    expect(source).toContain('[attr.aria-pressed]="showPassword()"');
    expect(source).toContain('class="absolute right-0 top-1/2 flex h-11 w-11');
    expect(source).toContain('focus-visible:ring-2');
    expect(source).toContain("? ['pr-12']");
    expect(source).not.toContain('tabindex="-1"');
  });
});
