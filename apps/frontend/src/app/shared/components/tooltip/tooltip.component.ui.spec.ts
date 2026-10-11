import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'tooltip.component.ts'), 'utf8');

describe('TooltipComponent accessible identity and styling source guards', () => {
  it('exposes a stable tooltip id and role and preserves other described-by ids', () => {
    expect(source).toContain('[id]="tooltipId"');
    expect(source).toContain('role="tooltip"');
    expect(source).toContain('readonly tooltipId = `tooltip-${Math.random().toString(36).slice(2, 11)}`;');
    expect(source).toContain("this.activeTrigger.setAttribute('aria-describedby', [...ids, this.tooltipId].join(' '));");
    expect(source).toContain(".filter((id) => id && id !== this.tooltipId)");
    expect(source).toContain("[attr.aria-hidden]=\"isVisible() ? null : 'true'\"");
  });

  it('dismisses a visible tooltip with Escape without swallowing Escape while hidden', () => {
    expect(source).toMatch(/if \(event\.key !== 'Escape' \|\| !this\.isVisible\(\)\) return;\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);/);
  });

  it('guards SSR viewport access and respects reduced motion with tokenized shadow colors', () => {
    expect(source).toContain("if (typeof window === 'undefined') return;");
    expect(source).toContain('@media (prefers-reduced-motion: reduce)');
    expect(source).toContain('animation: none;');
    expect(source).toContain('color-mix(in srgb, var(--color-neutral-900, #111827)');
    expect(source).toContain('color-mix(in srgb, var(--color-surface, #fff)');
    expect(source).toContain('var(--color-text-primary, #111827)');
    expect(source).toContain('this.removeDescribedBy();\n      if (this.showTimeout)');
  });
});
