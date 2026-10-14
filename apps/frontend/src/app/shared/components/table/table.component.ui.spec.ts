import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'table.component.ts'), 'utf8');

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

  it('preserves configured text colors for hex, RGB, CSS tokens and named colors', () => {
    const textColorMethod = source.split('getBadgeTextColor(column: TableColumn, value: any)')[1]?.split('getBadgeBorderColor')[0] ?? '';
    expect(textColorMethod).toContain('return this.getBadgeColorFromMap(column, value);');
    expect(textColorMethod).not.toContain('var(--color-text-primary)');
  });
});
