import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'dian-document-type-card.component.ts'), 'utf8');
const template = source.split('template: `')[1]?.split('`,\n})')[0] ?? '';

describe('DIAN document type card accessibility source guards', () => {
  it('uses the primary foreground for all textual summaries and checklist copy', () => {
    const secondaryForegrounds = template.match(/text-\[var\(--color-text-secondary\)\]/g) ?? [];
    expect(secondaryForegrounds).toHaveLength(1);
    expect(template).toContain('bg-[var(--color-surface)] text-[var(--color-text-secondary)]');
    expect(template).toContain('text-[var(--color-text-primary)] font-medium');
    expect(template).not.toContain('text-[var(--color-success)] font-medium');
    expect(template).not.toContain('text-[var(--color-warning)] font-medium');
    expect(template.match(/text-\[var\(--color-warning\)\] shrink-0 mt-0\.5/g)).toHaveLength(2);
    expect(template).toContain("'text-[var(--color-success)] shrink-0'");
  });

  it('gives every action button a minimum 44px hit area without changing its API', () => {
    const buttons = template.match(/<app-button\b[\s\S]*?>/g) ?? [];

    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button).toContain('customClasses="min-h-11 w-full sm:w-auto"');
      expect(button).toContain('size="sm"');
      expect(button).toContain('[disabled]="busy()"');
    }
    expect(template).toContain('(clicked)="configure.emit(axis())"');
    expect(template).toContain('(clicked)="viewDetail.emit(axis())"');
  });
});
