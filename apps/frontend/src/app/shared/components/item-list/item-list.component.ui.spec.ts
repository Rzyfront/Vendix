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

  it('keeps all mobile card metadata readable and uses the theme shadow token', () => {
    const mobileStyles = styles.split('@media (max-width: 767px)')[1]?.split('// Nota:')[0] ?? '';
    const mobileSubtitle = mobileStyles.match(/\.card-subtitle\s*\{([\s\S]*?)\n  \}/)?.[1] ?? '';
    const mobileDetailLabel = mobileStyles.match(/\.detail-label\s*\{([\s\S]*?)\n  \}/)?.[1] ?? '';
    const mobileFooterLabel = mobileStyles.match(/\.footer-label\s*\{([\s\S]*?)\n    \}/)?.[1] ?? '';
    const mobileCard = mobileStyles.match(/\.item-card\s*\{([\s\S]*?)\n  \}/)?.[1] ?? '';

    for (const block of [mobileSubtitle, mobileDetailLabel, mobileFooterLabel]) {
      expect(block).toContain('color: var(--color-text-primary);');
      expect(block).not.toMatch(/color:\s*var\(--color-neutral-(?:400|500)\)/);
    }
    expect(mobileCard).toContain('box-shadow: var(--shadow-sm);');
    expect(mobileCard).not.toContain('rgba(0, 0, 0, 0.05)');
  });

  it('allows long detail values to wrap inside three equal card columns', () => {
    const gridStyles = styles.match(/\.card-details-grid\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const detailItemStyles = styles.match(/\.detail-item\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const detailValueWrapStyles = styles.match(/\.detail-value-wrap\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const detailValueStyles = styles.match(/\.detail-value\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(gridStyles).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
    expect(detailItemStyles).toContain('min-width: 0;');
    expect(detailValueWrapStyles).toContain('min-width: 0;');
    expect(detailValueStyles).toContain('min-width: 0;');
    expect(detailValueStyles).toContain('overflow-wrap: anywhere;');
  });

  it('uses two columns only for avatar cards on very narrow screens', () => {
    const baseGridStyles = styles.match(/\.card-details-grid\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const narrowStyles = styles.split('@media (max-width: 479px)')[1] ?? '';
    const avatarGridStyles = narrowStyles.match(/\.card-avatar-wrapper\s*\+\s*\.card-main-content\s+\.card-details-grid\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(baseGridStyles).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
    expect(avatarGridStyles).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
  });
});
