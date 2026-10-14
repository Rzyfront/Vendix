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

  it('resets Escape dismissal only when an explicit external visible input becomes false', () => {
    expect(source).toContain('if (this.visible() === false) this.escapeDismissed.set(false);');
    expect(source).not.toContain('if (this.visible() === undefined) this.escapeDismissed.set(false);');
  });

  it('guards SSR viewport access, cleans described-by and cancels pending timers', () => {
    expect(source).toContain("if (typeof window === 'undefined') return;");
    expect(source).toContain('this.removeDescribedBy();\n      if (this.showTimeout)');
    expect(source).toContain('clearTimeout(this.showTimeout);');
    expect(source).toContain('cancelAnimationFrame(this.positionFrame);');
  });

  it('resets Escape dismissal on hover and focus reentry', () => {
    expect(source).toMatch(/onMouseEnter\(event: MouseEvent\)[\s\S]*?this\.escapeDismissed\.set\(false\);/);
    expect(source).toMatch(/onFocusIn\(event: FocusEvent\)[\s\S]*?this\.escapeDismissed\.set\(false\);/);
  });

  it('respects reduced motion while preserving the original normal and AI tooltip colors', () => {
    expect(source).toContain('@media (prefers-reduced-motion: reduce)');
    expect(source).toContain('animation: none;');
    expect(source).toContain('transition: none;');
    expect(source).toContain('drop-shadow(0 4px 12px rgba(0, 0, 0, 0.15))');
    expect(source).toContain('rgba(255, 255, 255, 0.1) 0%');
    expect(source).toContain('rgba(var(--color-primary-rgb), 0.85) 0%');
    expect(source).toContain('rgba(var(--color-primary-rgb), 0.95) 50%');
    expect(source).toContain('color: white;');
    expect(source).toContain('border: 1px solid rgba(255, 255, 255, 0.2);');
  });
});
