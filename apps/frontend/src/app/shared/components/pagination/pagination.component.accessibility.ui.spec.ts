import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const componentDir = __dirname;
const styles = readFileSync(join(componentDir, 'pagination.component.scss'), 'utf8');
const template = readFileSync(join(componentDir, 'pagination.component.html'), 'utf8');
const source = readFileSync(join(componentDir, 'pagination.component.ts'), 'utf8');

describe('pagination compact appearance and accessibility source guards', () => {
  it('keeps 32px arrows and pages without the new wrapped controls layout', () => {
    const arrowStyles = styles.match(/\.pagination-arrow\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const pageStyles = styles.match(/\.pagination-page\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const controlsStyles = styles.match(/\.pagination-controls\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(arrowStyles).toContain('width: 32px;');
    expect(arrowStyles).toContain('height: 32px;');
    expect(pageStyles).toContain('min-width: 32px;');
    expect(pageStyles).toContain('height: 32px;');
    expect(controlsStyles).not.toContain('flex-wrap: wrap;');
    expect(controlsStyles).not.toContain('justify-content: center;');
    expect(styles).not.toContain('max-width: 100%;');
  });

  it('preserves pagination inputs, current-page semantics, limits, and self-hiding behavior', () => {
    expect(source).toContain('readonly currentPage = input<number>(1);');
    expect(source).toContain('readonly totalPages = input<number>(0);');
    expect(source).toContain('readonly pageChange = output<number>();');
    expect(source).toContain('return this.totalPages() > 1;');
    expect(source).toContain('if (typeof page === \'string\') return;');
    expect(source).toContain('page >= 1 && page <= this.totalPages() && page !== this.currentPage()');
    expect(template).toContain('[class.active]="isActivePage(page)"');
    expect(template).toContain('[attr.aria-current]="isActivePage(page) ? \'page\' : null"');
    expect(template).toContain('aria-label="Previous page"');
    expect(template).toContain('aria-label="Next page"');
  });

  it('retains secondary controls, muted information, native focus, and opt-in reduced motion', () => {
    expect(styles).toContain('color: var(--color-text-secondary);');
    expect(styles).toContain('color: var(--color-text-muted);');
    expect(styles).not.toContain('outline: 2px solid var(--color-text-primary);');
    expect(styles).not.toContain('outline: none;');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('transition: none;');
  });
});
