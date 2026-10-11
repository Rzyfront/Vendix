import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'button.component.ts'), 'utf8');

describe('ButtonComponent keyboard focus source guards', () => {
  it('provides every variant a solid high-contrast focus-visible outline', () => {
    expect(source).toContain("'focus-visible:outline'");
    expect(source).toContain("'focus-visible:outline-2'");
    expect(source).toContain("'focus-visible:outline-offset-2'");
    expect(source).toContain("'focus-visible:outline-[var(--color-text-primary)]'");
  });

  it('preserves existing variants, loading behavior, and click output', () => {
    expect(source).toContain("readonly variant = input<ButtonVariant>('primary');");
    expect(source).toContain('[disabled]="disabled() || loading()"');
    expect(source).toContain('(click)="handleClick($event)"');
    expect(source).toContain('readonly clicked = output<Event>();');
  });
});
