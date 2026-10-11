import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'inputsearch.component.ts'), 'utf8');
const styles = readFileSync(join(__dirname, 'inputsearch.component.scss'), 'utf8');

describe('inputsearch touch target source guards', () => {
  it('keeps the physical input and wrapper above 44px including the wrapper border', () => {
    expect(styles).toContain('min-height: calc(44px + 2 * var(--border-width, 1px));');
    expect(styles).toContain('min-height: 44px;');
    expect(styles).toContain('width: 44px;');
    expect(styles).toContain('height: 44px;');
    expect(styles).toContain('padding-right: 3rem;');
  });

  it('provides an accessible label fallback and retains the debounced CVA search flow', () => {
    expect(source).toContain('[attr.aria-label]="ariaLabel() || placeholder() || \'Buscar\'"');
    expect(source).toContain('this.onChange(next);');
    expect(source).toContain('this.searchSubject$.next(next);');
    expect(source).toContain('debounceTime(this.debounceTime())');
  });

  it('removes input-control transitions and press scaling when reduced motion is preferred', () => {
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('transition: none;');
    expect(styles).toContain('transform: none;');
  });
});
