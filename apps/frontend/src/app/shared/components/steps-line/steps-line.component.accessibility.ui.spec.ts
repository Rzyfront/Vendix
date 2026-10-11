import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'steps-line.component.ts'), 'utf8');

describe('StepsLineComponent contrast source guards', () => {
  it('uses primary text for every step label in horizontal and vertical layouts', () => {
    expect(source.match(/\[style\.color\]="'var\(--color-text-primary\)'"/g)?.length).toBe(2);
    expect(source).not.toContain("i <= currentStep() ? primaryColor() : 'var(--color-text-secondary)' ");
    expect(source).not.toContain("i <= currentStep() ? primaryColor() : 'var(--color-text-secondary)'");
  });

  it('uses primary text for step numbers and text-on-primary for completed checks while retaining primary fills', () => {
    expect(source.match(/isCompleted\(i, step\) \? 'var\(--color-text-on-primary\)' : 'var\(--color-text-primary\)'/g)?.length).toBe(2);
    expect(source).toContain('[class.bg-primary]="isCompleted(i, step)"');
    expect(source).toContain('[class.border-primary]="i <= currentStep()"');
    expect(source).not.toContain('[class.text-white]="isCompleted(i, step)"');
    expect(source).toContain('readonly clickable = input(false);');
  });

  it('uses targeted step transitions and disables motion when requested', () => {
    expect(source.match(/transition-\[background-color,border-color,box-shadow,color\][^\"]*motion-reduce:transition-none/g)?.length).toBe(2);
    expect(source.match(/transition-colors duration-300 motion-reduce:transition-none/g)?.length).toBe(4);
  });
});
