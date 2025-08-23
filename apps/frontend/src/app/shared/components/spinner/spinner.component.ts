import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type SpinnerSize = 'sm' | 'md' | 'lg' | 'xl';

@Component({
  selector: 'app-spinner',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div [class]="containerClasses">
      <svg 
        [class]="spinnerClasses"
        fill="none" 
        viewBox="0 0 24 24"
      >
        <circle 
          class="opacity-25" 
          cx="12" 
          cy="12" 
          r="10" 
          stroke="currentColor" 
          stroke-width="4"
        ></circle>
        <path 
          class="opacity-75" 
          fill="currentColor" 
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        ></path>
      </svg>
      
      <span *ngIf="text" [class]="textClasses">
        {{ text }}
      </span>
    </div>
  `
})
export class SpinnerComponent {
  @Input() size: SpinnerSize = 'md';
  @Input() text?: string;
  @Input() color = 'text-primary';
  @Input() center = false;
  @Input() customClasses = '';

  get containerClasses(): string {
    const baseClasses = ['flex', 'items-center', 'gap-2'];
    
    const centerClasses = this.center 
      ? ['justify-center', 'w-full', 'h-full'] 
      : [];

    const classes = [
      ...baseClasses,
      ...centerClasses
    ];

    if (this.customClasses) {
      classes.push(this.customClasses);
    }

    return classes.join(' ');
  }

  get spinnerClasses(): string {
    const baseClasses = ['animate-spin', this.color];

    const sizeClasses = {
      sm: ['h-4', 'w-4'],
      md: ['h-6', 'w-6'],
      lg: ['h-8', 'w-8'],
      xl: ['h-12', 'w-12']
    };

    return [
      ...baseClasses,
      ...sizeClasses[this.size]
    ].join(' ');
  }

  get textClasses(): string {
    const baseClasses = ['text-text-secondary'];

    const sizeClasses = {
      sm: ['text-sm'],
      md: ['text-base'],
      lg: ['text-lg'],
      xl: ['text-xl']
    };

    return [
      ...baseClasses,
      ...sizeClasses[this.size]
    ].join(' ');
  }
}
