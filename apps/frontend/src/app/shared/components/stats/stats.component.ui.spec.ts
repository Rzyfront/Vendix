import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const styles = readFileSync(join(__dirname, 'stats.component.scss'), 'utf8');

describe('stats theme and motion source guards', () => {
  it('uses the primary text token for titles and contextual small text', () => {
    const titleStyles = styles.match(/\.stat-title\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const smallTextStyles = styles.match(/\.stat-small\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(titleStyles).toContain('text-text-primary');
    expect(smallTextStyles).toContain('text-text-primary');
    expect(titleStyles).not.toContain('text-text-secondary');
    expect(smallTextStyles).not.toMatch(/text-(?:emerald|green)-/);
    expect(smallTextStyles).not.toMatch(/#[\da-f]{3,8}\b|rgba?\(/i);
  });

  it('preserves the shared stats strip card sizing and disables skeleton shimmer for reduced motion', () => {
    expect(styles).toContain('width: 160px;');
    expect(styles).toContain('min-height: 88px;');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.stat-skeleton[\s\S]*?animation:\s*none;/);
  });
});
