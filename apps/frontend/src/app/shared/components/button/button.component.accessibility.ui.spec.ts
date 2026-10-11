import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'button.component.ts'), 'utf8');
const variants = source.match(/const variantClasses = \{([\s\S]*?)\n    \};/)?.[1] ?? '';
const outlineVariant = variants.match(/\boutline:\s*\[([\s\S]*?)\],/)?.[1] ?? '';

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

  it('keeps projected action text in the accessible name while visually hiding it during loading', () => {
    expect(source).toContain('<span class="btn-text" [class.sr-only]="loading() && !showTextWhileLoading()">');
    expect(source).toContain('<ng-content></ng-content>');
    expect(source).not.toContain('@if (!loading() || showTextWhileLoading())');
    expect(source).not.toContain('[attr.aria-hidden]');
  });

  it('uses text-primary only for standard outline foreground and preserves its branded border and focus ring', () => {
    expect(outlineVariant).toContain("'text-[var(--color-text-primary)]'");
    expect(outlineVariant).toContain("'btn-outline-border'");
    expect(outlineVariant).toContain("'focus:ring-[var(--color-primary)]/50'");
    expect(outlineVariant).not.toContain("'text-[var(--color-primary)]'");

    const secondaryOutline = variants.match(/'outline-secondary':\s*\[([\s\S]*?)\],/)?.[1] ?? '';
    expect(secondaryOutline).toContain("'text-[var(--color-secondary)]'");
    expect(secondaryOutline).toContain("'btn-outline-secondary-border'");
  });
});
