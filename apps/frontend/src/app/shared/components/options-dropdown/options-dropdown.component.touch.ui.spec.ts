import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const styles = readFileSync(join(__dirname, 'options-dropdown.component.scss'), 'utf8');
const template = readFileSync(join(__dirname, 'options-dropdown.component.html'), 'utf8');

describe('options-dropdown compact appearance source guards', () => {
  it('keeps the original 40px mobile and 44px desktop trigger with compact filter controls', () => {
    expect(styles).toContain('height: 2.5rem;');
    expect(styles).toContain('width: 2.5rem;');
    expect(styles).toMatch(/@media \(min-width: 640px\)\s*\{\s*height: 2\.75rem;/);
    expect(styles).toContain('.clear-filter-btn {');
    expect(styles).toContain('width: 1.25rem;');
    expect(styles).toContain('height: 1.25rem;');
    expect(styles).not.toContain('min-height: 44px;');
    expect(styles).not.toContain('min-width: 44px;');
  });

  it('retains the original focus rings and opt-in reduced motion', () => {
    expect(styles).toContain('box-shadow: 0 0 0 2px var(--color-ring);');
    expect(styles).toContain('box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.2);');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('transition: none;');
    expect(styles).toContain('transform: none;');
    expect(styles).not.toContain('outline: 2px solid var(--color-text-primary);');
  });

  it('keeps secondary filter labels and help copy', () => {
    expect(styles).toContain('.header-pin-label {\n    font-size: var(--fs-xs);\n    color: var(--color-text-secondary);');
    expect(styles).toContain('.filter-help-text {\n  font-size: var(--fs-xs);\n  color: var(--color-text-secondary);');
    expect(styles).toContain('.filter-checkbox-label {\n    font-size: var(--fs-xs);\n    color: var(--color-text-secondary);');
  });

  it('keeps the small selector and original date font without changing filter bindings', () => {
    expect(template).toMatch(/<app-selector[\s\S]*?size="sm"/);
    expect(template).toContain('(valueChange)="onFilterChange(filter.key, $event)"');
    expect(styles).toContain('.date-filter-input {\n  width: 100%;\n  padding: 0.375rem 0.75rem;\n  font-size: var(--fs-sm);');
    expect(styles).not.toContain('font-size: max(16px, var(--fs-sm));');
  });
});
