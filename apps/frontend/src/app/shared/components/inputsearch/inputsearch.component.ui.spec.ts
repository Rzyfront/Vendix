import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'inputsearch.component.ts'), 'utf8');
const styles = readFileSync(join(__dirname, 'inputsearch.component.scss'), 'utf8');

describe('Inputsearch original appearance and accessible behavior source guards', () => {
  it('keeps size-dependent wrapper heights and the original clear-button padding', () => {
    expect(styles).toContain('height: constants.$height-sm-mobile;');
    expect(styles).toContain('height: constants.$height-md-mobile;');
    expect(styles).toContain('height: constants.$height-lg-mobile;');
    expect(styles).toContain('height: constants.$height-sm-desktop;');
    expect(styles).toContain('height: constants.$height-md-desktop;');
    expect(styles).toContain('height: constants.$height-lg-desktop;');
    expect(styles).toContain('right: 0.375rem;\n    padding: 0.25rem;');
    expect(styles).toContain('right: 0.5rem;\n    padding: 0.375rem;');
    expect(styles).toContain('right: 0.75rem;\n    padding: 0.5rem;');
    expect(styles).toContain('padding-right: 2rem;');
    expect(styles).not.toContain('min-height: 44px;');
  });

  it('provides an accessible label fallback and retains the debounced CVA search flow', () => {
    expect(source).toContain('[attr.aria-label]="ariaLabel() || placeholder() || \'Buscar\'"');
    expect(source).toContain('this.onChange(next);');
    expect(source).toContain('this.searchSubject$.next(next);');
    expect(source).toContain('debounceTime(this.debounceTime())');
  });

  it('removes transitions, animation and press scaling only when reduced motion is preferred', () => {
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('transition: none;');
    expect(styles).toContain('transform: none;');
    expect(styles).toContain('animation: none;');
  });

  it('retains original placeholder/help foregrounds and the existing focus ring', () => {
    expect(styles).toContain('&::placeholder {\n    color: var(--color-text-secondary);');
    expect(styles).toContain('.help-text {\n    color: var(--color-text-secondary);');
    expect(styles).toContain('box-shadow: 0 0 0 2px var(--color-ring);');
    expect(styles).toContain('box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.2);');
  });
});
