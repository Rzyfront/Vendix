import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'toggle.component.ts'), 'utf8');

describe('toggle touch target source guards', () => {
  it('keeps a 44px button hit area around the original 44x24 track', () => {
    expect(source).toContain("'h-11'");
    expect(source).toContain("'w-11'");
    expect(source).toContain('inline-flex h-6 w-11 items-center');
    expect(source).toContain('[class.translate-x-5]="isOn()"');
    expect(source).toContain('this.onChange(this.isOn());');
    expect(source).toContain('this.toggled.emit(this.isOn());');
  });

  it('preserves visible keyboard focus and honors reduced motion on the track control', () => {
    expect(source).toContain('focus-visible:shadow-');
    expect(source).toContain('var(--color-text-primary)');
    expect(source).not.toContain('var(--color-ring)');
    expect(source).toContain("'motion-reduce:transition-none'");
    expect(source).toContain('motion-reduce:transition-none');
  });
});
