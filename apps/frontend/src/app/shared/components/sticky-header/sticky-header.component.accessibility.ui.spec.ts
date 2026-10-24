import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const template = readFileSync(join(__dirname, 'sticky-header.component.html'), 'utf8');
const styles = readFileSync(join(__dirname, 'sticky-header.component.scss'), 'utf8');

describe('StickyHeader compact tabs and accessible controls source guards', () => {
  it('retains the original title, subtitle, metadata, icon, and tab hierarchy', () => {
    expect(template).toContain('border-b border-gray-200 shadow-sm');
    expect(template).toContain('font-bold text-gray-900 truncate');
    expect(template).toContain('sticky-header-subtitle hidden sm:block text-xs text-gray-500');
    expect(template).toContain('hidden md:block text-xs text-gray-400 italic');
    expect(template).toContain('md:!w-[18px] md:!h-[18px] text-gray-500');
    expect(template).toContain('class="text-primary-600"');
    expect(styles).toContain('color: color-mix(in srgb, var(--color-text-primary) 66%, transparent);');
    expect(styles).toContain('color: color-mix(in srgb, var(--color-text-primary) 48%, transparent);');
    expect(styles).toContain('outline: 2px solid rgba(var(--color-primary-rgb), 0.45);');
    expect(styles).toContain('outline-offset: -1px;');
  });

  it('keeps compact tabs within the preexisting horizontal scroll rail and tab semantics', () => {
    expect(template).toContain('role="tablist"');
    expect(template).toContain('role="tab"');
    expect(template).toContain('[attr.aria-selected]');
    expect(styles.match(/\.sticky-header-tab\s*\{[\s\S]*?min-height:\s*1\.375rem;/g)?.length).toBe(2);
    expect(styles).toContain('overflow-x: auto;');
    expect(styles).toContain('scroll-snap-type: x mandatory;');
    expect(styles).not.toContain('min-height: 44px;');
  });

  it('keeps back 28/32px and actions 36px with accessible back navigation', () => {
    expect(template).toContain('customClasses="!p-0 !w-7 !h-7 md:!w-8 md:!h-8');
    expect(template).toContain('!h-9 !w-9 !px-0');
    expect(template).toContain('md:!rounded-lg md:!h-9 md:!px-3 md:!w-auto');
    expect(template).toContain('shadow-primary-200');
    expect(template).toContain('ariaLabel="Volver"');
    expect(template).toContain('(clicked)="onActionClick(action.id)"');
  });
});
