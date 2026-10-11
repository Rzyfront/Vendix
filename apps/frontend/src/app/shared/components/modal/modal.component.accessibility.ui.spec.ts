import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'modal.component.ts'), 'utf8');

describe('ModalComponent accessible header source guards', () => {
  it('keeps the close control at least 44px square with a solid keyboard focus outline', () => {
    expect(source).toContain('h-11 w-11 border border-[rgba(var(--color-error-rgb),0.45)]');
    expect(source).toContain('focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-primary)]');
    expect(source).toContain('aria-label="Cerrar modal"');
  });

  it('uses primary text contrast for subtitles and disables close-button motion when requested', () => {
    expect(source).toContain('text-[var(--fs-xs)] md:text-[var(--fs-sm)] leading-tight text-[var(--color-text-primary)]');
    expect(source).toContain('transition-all duration-200 motion-reduce:transition-none');
  });
});
