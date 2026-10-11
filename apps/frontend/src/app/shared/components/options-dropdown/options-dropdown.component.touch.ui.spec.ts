import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const styles = readFileSync(join(__dirname, 'options-dropdown.component.scss'), 'utf8');

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
  });
});
