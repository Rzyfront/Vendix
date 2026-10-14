import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, 'steps-line.component.ts'), 'utf8');

describe('StepsLineComponent original hierarchy source guards', () => {
  it('keeps active/current labels primary and inactive labels secondary in both layouts', () => {
    expect(source.match(/\[style\.color\]="i <= currentStep\(\) \? primaryColor\(\) : 'var\(--color-text-secondary\)'"/g)?.length).toBe(2);
    expect(source).toContain('[class.!font-semibold]="i === currentStep()"');
  });

  it('keeps original current/inactive/completed circle colors and fills', () => {
    expect(source.match(/i === currentStep\(\) \? primaryColor\(\) : \(isCompleted\(i, step\) \? 'white' : 'var\(--color-text-secondary\)'\)/g)?.length).toBe(2);
    expect(source).toContain('[class.bg-primary]="isCompleted(i, step)"');
    expect(source).toContain('[class.border-primary]="i <= currentStep()"');
    expect(source).toContain('[class.text-white]="isCompleted(i, step)"');
    expect(source).not.toContain('var(--color-text-on-primary)');
  });

  it('preserves clickable state, explicit completion, and opt-in vertical fill', () => {
    expect(source).toContain('readonly clickable = input(false);');
    expect(source).toContain('if (this.clickable()) {');
    expect(source).toContain('this.stepClicked.emit(index);');
    expect(source).toContain('return index < this.currentStep() || !!step.completed;');
    expect(source).toContain('readonly fillHeight = input(false);');
  });

  it('keeps targeted transitions and disables motion only when requested', () => {
    expect(source.match(/transition-\[background-color,border-color,box-shadow,color\][^"]*motion-reduce:transition-none/g)?.length).toBe(2);
    expect(source.match(/transition-colors duration-300 motion-reduce:transition-none/g)?.length).toBe(4);
  });
});
