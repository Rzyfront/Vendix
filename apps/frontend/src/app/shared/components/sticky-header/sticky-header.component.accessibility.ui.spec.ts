import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const template = readFileSync(join(__dirname, 'sticky-header.component.html'), 'utf8');
const styles = readFileSync(join(__dirname, 'sticky-header.component.scss'), 'utf8');

describe('StickyHeader accessible tabs and controls source guards', () => {
  it('uses primary foregrounds for subtitle, metadata, back icon, and tab text/icons', () => {
    expect(template).toContain('sticky-header-subtitle hidden sm:block text-xs text-text-primary');
    expect(template).toContain('hidden md:block text-xs text-text-primary italic');
    expect(template).toContain('md:!w-[18px] md:!h-[18px] text-text-primary');
    expect(styles).toContain('color: var(--color-text-primary);');
    expect(styles).not.toContain('color: color-mix(in srgb, var(--color-text-primary) 66%, transparent);');
    expect(styles).not.toContain('color: color-mix(in srgb, var(--color-text-primary) 48%, transparent);');
    expect(styles).toContain('outline: 2px solid var(--color-text-primary);');
  });

  it('keeps tabs at least 44px in the horizontal scroll rail and retains tab semantics', () => {
    expect(template).toContain('role="tablist"');
    expect(template).toContain('role="tab"');
    expect(styles.match(/\.sticky-header-tab\s*\{[\s\S]*?min-height:\s*44px;/g)?.length).toBe(2);
    expect(styles).toContain('overflow-x: auto;');
    expect(styles).toContain('scroll-snap-type: x mandatory;');
  });

  it('keeps back and mobile action targets 44px without narrowing desktop text actions', () => {
    expect(template).toContain('customClasses="!p-0 !w-11 !h-11 md:!w-11 md:!h-11');
    expect(template).toContain('!h-11 !w-11 !px-0');
    expect(template).toContain('md:!rounded-lg md:!h-11 md:!px-3 md:!w-auto');
    expect(template).not.toContain('!w-7 !h-7');
    expect(template).not.toContain('!h-9 !w-9');
    expect(template).toContain('ariaLabel="Volver"');
  });
});
