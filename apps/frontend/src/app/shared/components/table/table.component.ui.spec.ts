import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'table.component.ts'), 'utf8');
const styles = readFileSync(join(__dirname, 'table.component.scss'), 'utf8');

describe('table custom badge color fallback source guards', () => {
  it('preserves existing hexadecimal and RGB soft-background conversions', () => {
    expect(source).toContain("if (color.startsWith('#')) {");
    expect(source).toContain('return this.hexToRgba(color, 0.15);');
    expect(source).toContain("} else if (color.startsWith('rgb') || color.startsWith('rgba')) {");
    expect(source).toContain("return color.replace(/[\\d.]+\\)$/, '0.15)');");
  });

  it('uses a theme-aware 15 percent color-mix fallback for other CSS colors', () => {
    expect(source).toContain('return `color-mix(in srgb, ${color} 15%, transparent)`;');
  });

  it('preserves existing hexadecimal and RGB border conversions', () => {
    expect(source).toContain('return this.hexToRgba(color, 0.3);');
    expect(source).toContain("return color.replace(/[\\d.]+\\)$/, '0.3)');");
  });

  it('uses a theme-aware 30 percent color-mix fallback without hardcoded colors', () => {
    expect(source).toContain('return `color-mix(in srgb, ${color} 30%, transparent)`;');
    expect(source).not.toMatch(/color-mix\([^\n]*(?:#[0-9a-f]{3,8}\b|rgba?\(\s*\d)/i);
  });

  it('keeps configured hex/RGB text colors and uses a theme foreground for CSS tokens/names', () => {
    expect(source).toContain("return color.startsWith('#') || color.startsWith('rgb')");
    expect(source).toContain("? color\n        : 'var(--color-text-primary)';");
  });
});

describe('table readable text and focus source guards', () => {
  it('uses the primary theme foreground for empty metadata and readable table labels', () => {
    for (const selector of ['.cell-content-empty', '.status-badge-default', '.table-action-empty', '.empty-message']) {
      const escaped = selector.replace('.', '\\.');
      const block = styles.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
      expect(block).toContain('color: var(--color-text-primary);');
    }
  });

  it('provides solid primary focus indication for table action controls', () => {
    expect(styles).toContain('outline: 2px solid var(--color-text-primary);');
    expect(styles).toContain('&:focus-visible');
  });
});
