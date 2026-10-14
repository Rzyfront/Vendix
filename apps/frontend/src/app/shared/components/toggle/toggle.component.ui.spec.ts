import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'toggle.component.ts'), 'utf8');

describe('toggle compact appearance and CVA source guards', () => {
  it('keeps the original 44x24 button without an inflated track wrapper', () => {
    expect(source).toContain("'h-6'");
    expect(source).toContain("'w-11'");
    expect(source).toContain("'border-2'");
    expect(source).toContain("'border-transparent'");
    expect(source).not.toContain("'h-11'");
    expect(source).not.toContain('inline-flex h-6 w-11 items-center');
    expect(source).toMatch(/\[class\]="buttonClasses"\s*\[style\.background-color\]/);
    expect(source).toContain('[class.translate-x-5]="isOn()"');
  });

  it('preserves pressed semantics, disabled guards, and CVA/output behavior', () => {
    expect(source).toContain('[attr.aria-pressed]="isOn()"');
    expect(source).toContain('[attr.aria-label]="ariaLabel() || label() || \'Toggle\'"');
    expect(source).toContain('[disabled]="isDisabled()"');
    expect(source).toContain('if (this.isDisabled()) return;');
    expect(source).toContain('this.isBoundToForm.set(true);');
    expect(source).toContain('this.isOn.set(!!value);');
    expect(source).toContain('this.onChange(this.isOn());');
    expect(source).toContain('this.toggled.emit(this.isOn());');
    expect(source).toContain('this.changed.emit(this.isOn());');
    expect(source).toContain('this.onTouched();');
  });

  it('keeps the original modern/classic focus ring and reduced motion', () => {
    expect(source).toContain('focus:shadow-[0_0_0_3px_var(--color-ring)]');
    expect(source).toContain('focus:ring-2');
    expect(source).toContain('focus:ring-[var(--color-ring)]');
    expect(source).toContain('focus:ring-offset-2');
    expect(source).toContain("'motion-reduce:transition-none'");
    expect(source).toContain('duration-75 ease-out motion-reduce:transition-none');
  });
});
