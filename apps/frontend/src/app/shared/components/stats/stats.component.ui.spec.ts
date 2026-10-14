import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const styles = readFileSync(join(__dirname, 'stats.component.scss'), 'utf8');

describe('stats theme and motion source guards', () => {
  it('preserves secondary titles and the original mobile small-text color', () => {
    const titleStyles = styles.match(/\.stat-title\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const smallTextStyles = styles.match(/\.stat-small\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(titleStyles).toContain('text-text-secondary');
    expect(smallTextStyles).not.toContain('text-text-primary');
    expect(smallTextStyles).toContain('@media (max-width: 639px)');
    expect(smallTextStyles).toContain('text-emerald-500');
  });

  it('preserves the shared stats strip card sizing and disables skeleton shimmer for reduced motion', () => {
    expect(styles).toContain('width: 160px;');
    expect(styles).toContain('min-height: 88px;');
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.stat-skeleton[\s\S]*?animation:\s*none;/);
  });
});
