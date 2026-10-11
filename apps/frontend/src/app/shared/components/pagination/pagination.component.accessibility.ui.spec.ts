import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const componentDir = __dirname;
const styles = readFileSync(join(componentDir, 'pagination.component.scss'), 'utf8');
const template = readFileSync(join(componentDir, 'pagination.component.html'), 'utf8');
const source = readFileSync(join(componentDir, 'pagination.component.ts'), 'utf8');

describe('pagination touch and accessibility source guards', () => {
  it('keeps arrow and page controls at 44px and makes long page runs wrap within the viewport', () => {
    const arrowStyles = styles.match(/\.pagination-arrow\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const pageStyles = styles.match(/\.pagination-page\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const controlsStyles = styles.match(/\.pagination-controls\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(arrowStyles).toContain('width: 44px;');
    expect(arrowStyles).toContain('height: 44px;');
    expect(pageStyles).toContain('min-width: 44px;');
    expect(pageStyles).toContain('height: 44px;');
    expect(controlsStyles).toContain('flex-wrap: wrap;');
    expect(controlsStyles).toContain('max-width: 100%;');
    expect(styles).toContain('max-width: 100%;');
  });

  it('preserves pagination inputs, current-page semantics, and self-hiding behavior', () => {
    expect(source).toContain('readonly currentPage = input<number>(1);');
    expect(source).toContain('readonly totalPages = input<number>(0);');
    expect(source).toContain('readonly pageChange = output<number>();');
    expect(source).toContain('return this.totalPages() > 1;');
    expect(template).toContain('[class.active]="isActivePage(page)"');
    expect(template).toContain('[attr.aria-current]="isActivePage(page) ? \'page\' : null"');
    expect(template).toContain('aria-label="Previous page"');
    expect(template).toContain('aria-label="Next page"');
  });

  it('uses readable foregrounds, solid visible focus, and reduced-motion transitions', () => {
    expect(styles).toContain('color: var(--color-text-primary);');
    expect(styles).toContain('outline: 2px solid var(--color-text-primary);');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('transition: none;');
    expect(styles).not.toContain('transition: all');
  });
});
