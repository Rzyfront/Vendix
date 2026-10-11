import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'item-list.component.ts'), 'utf8');
const styles = readFileSync(join(__dirname, 'item-list.component.scss'), 'utf8');

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

describe('item-list action touch target source guards', () => {
  it('keeps direct actions, overflow trigger, and overflow menu items touch-sized', () => {
    const actionStyles = styles.match(/\.footer-action-btn\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const menuItemStyles = styles.match(/\.menu-item\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(actionStyles).toContain('width: 44px;');
    expect(actionStyles).toContain('height: 44px;');
    expect(actionStyles).toContain('min-width: 44px;');
    expect(menuItemStyles).toContain('min-height: 44px;');
    expect(styles).toContain(':focus-visible');
  });

  it('avoids animated transforms and transitions when reduced motion is preferred', () => {
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('transition: none;');
    expect(styles).toContain('transform: none;');
  });

  it('uses the primary theme foreground for card metadata and empty-state copy', () => {
    for (const selector of ['.empty-message', '.card-note', '.card-subtitle', '.status-badge-default', '.detail-label', '.text-default', '.footer-label']) {
      const block = styles.match(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
      expect(block).toContain('color: var(--color-text-primary);');
    }
    expect(styles).toContain('outline: 2px solid var(--color-text-primary);');
  });
});
