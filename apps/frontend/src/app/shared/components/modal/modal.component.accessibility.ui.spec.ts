import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'modal.component.ts'), 'utf8');

describe('ModalComponent compact accessible header source guards', () => {
  it('keeps the close control 32/36px with the original error focus ring and name', () => {
    expect(source).toContain('h-8 w-8 md:h-9 md:w-9 border border-[rgba(var(--color-error-rgb),0.45)]');
    expect(source).toContain('focus:outline-none focus:ring-2 focus:ring-[rgba(var(--color-error-rgb),0.4)]');
    expect(source).toContain('aria-label="Cerrar modal"');
    expect(source).toContain('(click)="close()"');
  });

  it('keeps secondary subtitles and opt-in reduced motion for the close button', () => {
    expect(source).toContain('text-[var(--fs-xs)] md:text-[var(--fs-sm)] leading-tight text-[var(--color-text-secondary)]');
    expect(source).toContain('transition-all duration-200 motion-reduce:transition-none');
  });

  it('preserves model visibility, optional dialog semantics, lifecycle outputs, and close guards', () => {
    expect(source).toContain('readonly isOpen = model<boolean>(false);');
    expect(source).toContain('readonly dialog = input<boolean>(false);');
    expect(source).toContain('readonly canClose = input<() => boolean | Promise<boolean>>(() => true);');
    expect(source).toContain('readonly closed = output<void>();');
    expect(source).toContain('readonly opened = output<void>();');
    expect(source).toContain('readonly cancel = output<void>();');
  });
});
