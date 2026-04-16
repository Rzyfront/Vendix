import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface StepsLineItem {
  label: string;
  completed?: boolean;
}

export type StepsLineSize = 'sm' | 'md' | 'lg';

@Component({
  selector: 'app-steps-line',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="w-full py-3 px-4">
      <!-- Horizontal -->
      @if (orientation() === 'horizontal') {
        <div class="flex items-start justify-between w-full">
          @for (step of steps(); track step.label; let i = $index) {
            @if (i > 0) {
              <div
                class="flex-1 h-0.5 rounded-full transition-colors duration-300"
                [class.bg-primary]="i <= currentStep()"
                [class.bg-border]="i > currentStep()"
                [style.margin-top]="circleOffset"
                [style.background-color]="i <= currentStep() ? primaryColor() : undefined"
              ></div>
            }
            <div class="flex flex-col items-center shrink-0 px-1"
              [class.cursor-pointer]="clickable()"
              (click)="onStepClick(i)">
              <div
                class="rounded-full flex items-center justify-center font-semibold transition-all duration-300 border-2 shrink-0"
                [ngClass]="circleClasses"
                [class.bg-primary]="i < currentStep()"
                [class.border-primary]="i <= currentStep()"
                [class.text-white]="i < currentStep()"
                [class.border-border]="i > currentStep()"
                [class.bg-surface]="i >= currentStep()"
                [style.box-shadow]="i === currentStep() ? '0 0 0 3px ' + primaryColorAlpha : 'none'"
                [style.color]="i === currentStep() ? primaryColor() : (i < currentStep() ? 'white' : 'var(--color-text-secondary)')"
                [style.border-color]="i <= currentStep() ? primaryColor() : undefined"
                [style.background-color]="i < currentStep() ? primaryColor() : undefined"
              >
                @if (i < currentStep()) {
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="3"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    [ngClass]="checkClasses"
                  >
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                } @else {
                  <span class="leading-none">{{ i + 1 }}</span>
                }
              </div>
              <span
                class="font-medium text-center whitespace-nowrap transition-colors duration-300 mt-1"
                [ngClass]="labelClasses"
                [style.color]="i <= currentStep() ? primaryColor() : 'var(--color-text-secondary)'"
                [class.!font-semibold]="i === currentStep()"
              >{{ step.label }}</span>
            </div>
          }
        </div>
      }

      <!-- Vertical -->
      @if (orientation() === 'vertical') {
        <div class="flex flex-col py-2">
          @for (step of steps(); track step.label; let i = $index) {
            @if (i > 0) {
              <div
                class="w-0.5 rounded-full transition-colors duration-300 ml-4 my-0.5"
                [ngClass]="verticalLineClasses"
                [class.bg-primary]="i <= currentStep()"
                [class.bg-border]="i > currentStep()"
                [style.background-color]="i <= currentStep() ? primaryColor() : undefined"
              ></div>
            }
            <div class="flex items-center gap-2"
              [class.cursor-pointer]="clickable()"
              (click)="onStepClick(i)">
              <div
                class="rounded-full flex items-center justify-center font-semibold transition-all duration-300 border-2 shrink-0"
                [ngClass]="circleClasses"
                [style.box-shadow]="i === currentStep() ? '0 0 0 3px ' + primaryColorAlpha : 'none'"
                [style.color]="i === currentStep() ? primaryColor() : (i < currentStep() ? 'white' : 'var(--color-text-secondary)')"
                [style.border-color]="i <= currentStep() ? primaryColor() : undefined"
                [style.background-color]="i < currentStep() ? primaryColor() : undefined"
              >
                @if (i < currentStep()) {
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="3"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    [ngClass]="checkClasses"
                  >
                    <polyline points="20 6 9 17 4 12"></polyline>
                  </svg>
                } @else {
                  <span class="leading-none">{{ i + 1 }}</span>
                }
              </div>
              <span
                class="font-medium whitespace-nowrap transition-colors duration-300"
                [ngClass]="labelClasses"
                [style.color]="i <= currentStep() ? primaryColor() : 'var(--color-text-secondary)'"
                [class.!font-semibold]="i === currentStep()"
              >{{ step.label }}</span>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class StepsLineComponent {
  readonly steps = input<StepsLineItem[]>([]);
  readonly currentStep = input(0);
  readonly primaryColor = input('var(--color-primary)');
  readonly secondaryColor = input('var(--color-secondary)');
  readonly size = input<StepsLineSize>('md');
  readonly orientation = input<'horizontal' | 'vertical'>('horizontal');
  readonly clickable = input(false);
  readonly stepClicked = output<number>();

  onStepClick(index: number): void {
    if (this.clickable()) {
      this.stepClicked.emit(index);
    }
  }

  get circleOffset(): string {
    const size = this.size();
    if (size === 'sm') return '0.75rem';
    if (size === 'lg') return '1.25rem';
    return '1rem'; // md
  }

  get circleClasses(): string {
    const size = this.size();
    if (size === 'sm') return 'w-6 h-6 text-[0.65rem]';
    if (size === 'lg') return 'w-10 h-10 text-sm';
    return 'w-8 h-8 text-xs'; // md
  }

  get checkClasses(): string {
    const size = this.size();
    if (size === 'sm') return 'w-2.5 h-2.5';
    if (size === 'lg') return 'w-[18px] h-[18px]';
    return 'w-3.5 h-3.5'; // md
  }

  get labelClasses(): string {
    const size = this.size();
    if (size === 'sm') return 'text-[0.6rem]';
    if (size === 'lg') return 'text-sm';
    return 'text-[0.7rem]'; // md
  }

  get verticalLineClasses(): string {
    const size = this.size();
    if (size === 'sm') return 'h-4';
    if (size === 'lg') return 'h-7';
    return 'h-5'; // md
  }

  get primaryColorAlpha(): string {
    return 'color-mix(in srgb, ' + this.primaryColor() + ' 25%, transparent)';
  }
}
