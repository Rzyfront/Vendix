import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-card',
  standalone: true,
  imports: [CommonModule],
  template: `
  <div [class]="cardClasses" [ngStyle]="cardStyles">
      <!-- Header -->
      <div 
        *ngIf="hasHeader" 
        class="px-6 py-4 border-b border-border"
        [class.pb-0]="!hasBody && !hasFooter"
      >
        <h3 *ngIf="title" class="text-lg font-semibold text-text-primary">
          {{ title }}
        </h3>
        <p *ngIf="subtitle" class="text-sm text-text-secondary mt-1">
          {{ subtitle }}
        </p>
        <ng-content select="[slot=header]"></ng-content>
      </div>

      <!-- Body -->
      <div 
        *ngIf="hasBody" 
        class="px-6 py-4"
        [class.pt-0]="hasHeader"
        [class.pb-0]="hasFooter"
      >
        <ng-content></ng-content>
      </div>

      <!-- Footer -->
      <div 
        *ngIf="hasFooter" 
        class="px-6 py-4 border-t border-border bg-gray-50"
        [class.pt-0]="!hasBody"
      >
        <ng-content select="[slot=footer]"></ng-content>
      </div>
    </div>
  `
})
export class CardComponent {
  @Input() title?: string;
  @Input() subtitle?: string;
  @Input() shadow: 'none' | 'sm' | 'md' | 'lg' | 'xl' = 'md';
  @Input() padding = true;
  @Input() customClasses = '';
  // Optional sizing inputs. Accept any valid CSS size (px, %, rem, etc.)
  @Input() width?: string;
  @Input() height?: string;
  @Input() maxWidth?: string;

  get cardClasses(): string {
    const baseClasses = [
      'bg-white',
      'border',
      'border-border',
      'rounded-lg',
      'overflow-hidden'
    ];

    const shadowClasses = {
      none: [],
      sm: ['shadow-sm'],
      md: ['shadow-md'],
      lg: ['shadow-lg'],
      xl: ['shadow-xl']
    };

    const paddingClasses = this.padding ? [] : ['p-0'];

    const classes = [
      ...baseClasses,
      ...shadowClasses[this.shadow],
      ...paddingClasses
    ];

    if (this.customClasses) {
      classes.push(this.customClasses);
    }

    return classes.join(' ');
  }

  get hasHeader(): boolean {
    return !!(this.title || this.subtitle);
  }

  get hasBody(): boolean {
    return true; // Always show body for default content
  }

  get hasFooter(): boolean {
    return false; // Will be determined by content projection
  }

  get cardStyles(): { [key: string]: string } | null {
    const styles: { [key: string]: string } = {};
    if (this.width) styles['width'] = this.width;
    if (this.height) styles['height'] = this.height;
    if (this.maxWidth) styles['max-width'] = this.maxWidth;
    return Object.keys(styles).length ? styles : null;
  }
}
