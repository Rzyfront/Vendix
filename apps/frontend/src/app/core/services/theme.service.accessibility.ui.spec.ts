import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ColorUtils } from '../utils/color.utils';

const source = readFileSync(join(__dirname, 'theme.service.ts'), 'utf8');

describe('ThemeService primary foreground contrast', () => {
  it('picks a readable foreground for light and dark branded primaries', () => {
    expect(ColorUtils.pickForeground('#2ECC71')).toBe('#0F172A');
    expect(ColorUtils.pickForeground('#003366')).toBe('#FFFFFF');
    for (const primary of ['#2ECC71', '#003366', '#F9FAFB', '#111827']) {
      expect(ColorUtils.contrastRatio(primary, ColorUtils.pickForeground(primary))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('derives text-on-primary from the final computed primary outside monocromo and preserves its custom contrast choice', () => {
    expect(source).toContain("if (normalized !== 'monocromo') {");
    expect(source).toContain("this.asHex(getComputedStyle(root).getPropertyValue('--color-primary'))");
    expect(source).toContain('ColorUtils.pickForeground(finalPrimary)');
    expect(source).toContain("'--color-text-on-primary': ColorUtils.pickForeground(finalPrimary)");
    expect(source).toContain("'--color-text-on-primary': monoOnPrimary");
  });
});
