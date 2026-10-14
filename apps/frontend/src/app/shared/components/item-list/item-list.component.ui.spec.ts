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

  it('uses valid color-mix backgrounds and borders while preserving the configured text color', () => {
    expect(source).toContain('bg = `color-mix(in srgb, ${color} 15%, transparent)`;');
    expect(source).toContain('borderColor = `1px solid color-mix(in srgb, ${color} 25%, transparent)`;');
    expect(source).toContain('color: color,');
    expect(source).not.toContain("textColor = 'var(--color-text-primary)';");
    expect(source).not.toContain('border: `1px solid ${color}40`,');
  });

  it('preserves detail and footer fallback values', () => {
    expect(source).toContain('getDetailValue(item: any, field: any): string');
    expect(source).toContain('field.defaultValue ?? \'-\'');
    expect(source).toContain('getFooterValue(item: any): string');
    expect(source).toContain('config.footerDefaultValue ?? \'-\'');
  });
});

describe('item-list original appearance and motion source guards', () => {
  it('preserves compact direct actions and the original overflow placement', () => {
    const actionStyles = styles.match(/\.footer-action-btn\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const menuItemStyles = styles.match(/\.menu-item\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(actionStyles).toContain('width: 30px;');
    expect(actionStyles).toContain('height: 30px;');
    expect(actionStyles).not.toContain('min-width: 44px;');
    expect(menuItemStyles).not.toContain('min-height: 44px;');
    expect(styles).toContain('bottom: 40px;');
    const mobileStyles = styles.split('@media (max-width: 767px)')[1] ?? '';
    expect(mobileStyles).toContain('width: 32px;');
    expect(mobileStyles).toContain('height: 32px;');
  });

  it('avoids animated transforms and transitions when reduced motion is preferred', () => {
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)');
    expect(styles).toContain('transition: none;');
    expect(styles).toContain('transform: none;');
  });

  it('keeps secondary empty and subtitle copy and muted metadata', () => {
    for (const selector of ['.empty-message', '.card-subtitle']) {
      const block = styles.match(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
      expect(block).toContain('color: var(--color-text-secondary);');
    }
    for (const selector of ['.card-note', '.status-badge-default', '.detail-label', '.text-default', '.footer-label']) {
      const block = styles.match(new RegExp(`${selector.replace('.', '\\.')}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
      expect(block).toContain('color: var(--color-text-muted);');
    }
  });

  it('preserves the original mobile metadata hierarchy and subtle shadow', () => {
    const mobileStyles = styles.split('@media (max-width: 767px)')[1]?.split('// Nota:')[0] ?? '';
    const mobileSubtitle = mobileStyles.match(/\.card-subtitle\s*\{([\s\S]*?)\n  \}/)?.[1] ?? '';
    const mobileDetailLabel = mobileStyles.match(/\.detail-label\s*\{([\s\S]*?)\n  \}/)?.[1] ?? '';
    const mobileFooterLabel = mobileStyles.match(/\.footer-label\s*\{([\s\S]*?)\n    \}/)?.[1] ?? '';
    const mobileCard = mobileStyles.match(/\.item-card\s*\{([\s\S]*?)\n  \}/)?.[1] ?? '';

    expect(mobileSubtitle).toContain('color: var(--color-neutral-500);');
    expect(mobileDetailLabel).toContain('color: var(--color-neutral-400);');
    expect(mobileFooterLabel).toContain('color: var(--color-neutral-400);');
    expect(mobileCard).toContain('box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);');
  });

  it('preserves the shared three-column detail layout', () => {
    const gridStyles = styles.match(/\.card-details-grid\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const detailItemStyles = styles.match(/\.detail-item\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const detailValueWrapStyles = styles.match(/\.detail-value-wrap\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    const detailValueStyles = styles.match(/\.detail-value\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(gridStyles).toContain('grid-template-columns: repeat(3, 1fr);');
    expect(detailItemStyles).not.toContain('min-width: 0;');
    expect(detailValueWrapStyles).not.toContain('min-width: 0;');
    expect(detailValueStyles).not.toContain('overflow-wrap: anywhere;');
    expect(styles).not.toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
  });
});
