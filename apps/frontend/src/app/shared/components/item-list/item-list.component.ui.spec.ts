import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'item-list.component.ts'), 'utf8');

describe('item-list custom badge style source guards', () => {
  it('preserves the existing six-digit hex background and border colors', () => {
    expect(source).toContain("if (color.startsWith('#') && color.length === 7) {");
    expect(source).toContain('bg = `${color}26`;');
    expect(source).toContain('let borderColor = `1px solid ${color}40`;');
  });

  it('uses color-mix for CSS-token backgrounds and borders with the theme foreground', () => {
    expect(source).toContain('bg = `color-mix(in srgb, ${color} 15%, transparent)`;');
    expect(source).toContain('borderColor = `1px solid color-mix(in srgb, ${color} 25%, transparent)`;');
    expect(source).toContain("textColor = 'var(--color-text-primary)';");
    expect(source).toContain('color: textColor,');
    expect(source).not.toContain('border: `1px solid ${color}40`,');
  });

  it('preserves detail and footer fallback values', () => {
    expect(source).toContain('getDetailValue(item: any, field: any): string');
    expect(source).toContain('field.defaultValue ?? \'-\'');
    expect(source).toContain('getFooterValue(item: any): string');
    expect(source).toContain('config.footerDefaultValue ?? \'-\'');
  });
});
