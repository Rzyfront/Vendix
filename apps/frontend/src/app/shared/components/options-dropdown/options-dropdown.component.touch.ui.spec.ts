import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const styles = readFileSync(join(__dirname, 'options-dropdown.component.scss'), 'utf8');
const template = readFileSync(join(__dirname, 'options-dropdown.component.html'), 'utf8');

describe('options-dropdown touch target source guards', () => {
  it('keeps triggers, action items, and filter clear controls at least 44px tall/wide', () => {
    expect(styles).toContain('min-height: 44px;');
    expect(styles).toContain('min-width: 44px;');
    expect(styles).toContain('width: 44px;');
    expect(styles).toContain('height: 44px;');
    expect(styles).toContain('.action-item {');
    expect(styles).toContain('.clear-filter-btn {');
  });

  it('uses visible focus and disables control motion when reduced motion is preferred', () => {
    expect(styles).toContain('&:focus-visible');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('transition: none;');
    expect(styles).toContain('transform: none;');
    expect(styles).toContain('outline: 2px solid var(--color-text-primary);');
    expect(styles).not.toContain('var(--color-ring)');
  });

  it('uses readable foregrounds for filter labels and help copy', () => {
    expect(styles).toContain('.header-pin-label {\n    font-size: var(--fs-xs);\n    color: var(--color-text-primary);');
    expect(styles).toContain('.filter-help-text {\n  font-size: var(--fs-xs);\n  color: var(--color-text-primary);');
    expect(styles).toContain('.filter-checkbox-label {\n    font-size: var(--fs-xs);\n    color: var(--color-text-primary);');
  });

  it('keeps the native selector/date filter readable on mobile', () => {
    expect(template).toMatch(/<app-selector[\s\S]*?size="lg"/);
    expect(styles).toContain('.date-filter-input {');
    expect(styles).toContain('font-size: max(16px, var(--fs-sm));');
  });
});
