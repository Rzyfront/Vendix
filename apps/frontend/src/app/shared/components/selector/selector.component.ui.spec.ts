import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'selector.component.ts'), 'utf8');

describe('SelectorComponent accessible help source guards', () => {
  it('keeps the help button outside the associated label with a contextual name and focus style', () => {
    expect(source).toContain('<div class="label-with-tooltip">');
    expect(source).toContain('<label [class]="labelClasses + \' !mb-0\'" [for]="id()">');
    expect(source).toContain('</label>\n          @if (tooltipText()) {');
    expect(source).toContain('class="help-icon inline-flex h-11 w-11');
    expect(source).toContain('[attr.aria-label]="\'Ayuda para \' + label()"');
    expect(source).toContain('focus-visible:ring-2');
  });
});
