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
        [class]="headerClasses"
        [class.pb-0]="!hasBody && !hasFooter"
      >
        <h3
          *ngIf="title"
          class="text-lg font-semibold text-[var(--color-text-primary)]"
        >
          {{ title }}
        </h3>
        <p
          *ngIf="subtitle"
          class="text-sm text-[var(--color-text-secondary)] mt-1"
        >
          {{ subtitle }}
        </p>
        <ng-content select="[slot=header]"></ng-content>
      </div>

      <!-- Body -->
      <div
        *ngIf="hasBody"
        [class]="bodyClasses"
        [class.pt-0]="hasHeader"
        [class.pb-0]="hasFooter"
      >
        <ng-content></ng-content>
      </div>

      <!-- Footer -->
      <div *ngIf="hasFooter" [class]="footerClasses" [class.pt-0]="!hasBody">
        <ng-content select="[slot=footer]"></ng-content>
      </div>
    </div>
  `,
  styles: [
    `
      @keyframes slide-up-fade-in {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      .animate-slide-up-fade-in {
        animation: slide-up-fade-in 0.4s ease-out forwards;
      }
    `,
  ],
})
export class CardComponent {
  @Input() title?: string;
  @Input() subtitle?: string;
  @Input() shadow: 'none' | 'sm' | 'md' | 'lg' | 'xl' = 'sm';
  @Input() padding = true;
  @Input() customClasses = '';
  @Input() animateOnLoad = false;
  /**
   * When true, applies mobile-first responsive padding (p-4 on mobile, p-6 on sm+).
   * Useful for forms and content that needs more breathing room on larger screens.
   */
  @Input() responsivePadding = false;
  /**
   * Controls the overflow behavior of the card.
   * Use 'visible' when you need tooltips or dropdowns to extend beyond the card boundaries.
   */
  @Input() overflow: 'hidden' | 'visible' | 'auto' = 'hidden';
  /**
   * When true, applies card styling only on md+ breakpoints (desktop).
   * Mobile shows transparent (no chrome). Useful for standard module list containers.
   */
  @Input() responsive = false;
  // Optional sizing inputs. Accept any valid CSS size (px, %, rem, etc.)
  @Input() width?: string;
  @Input() height?: string;
  @Input() maxWidth?: string;

  get cardClasses(): string {
    const classes: string[] = [];

    // Use literal class strings so Tailwind can detect them at build time.
    // NEVER concatenate prefixes dynamically (e.g. `prefix + class`) — Tailwind purges them.
    if (this.responsive) {
      classes.push(
        'md:bg-[var(--color-surface)]',
        'md:border',
        'md:border-[var(--color-border)]',
        'md:rounded-[var(--radius-lg)]',
      );
    } else {
      classes.push(
        'bg-[var(--color-surface)]',
        'border',
        'border-[var(--color-border)]',
        'rounded-[var(--radius-lg)]',
      );
    }

    // Overflow — literal classes per value
    const overflowClasses = this.responsive
      ? { hidden: 'md:overflow-hidden', visible: 'md:overflow-visible', auto: 'md:overflow-auto' }
      : { hidden: 'overflow-hidden', visible: 'overflow-visible', auto: 'overflow-auto' };
    classes.push(overflowClasses[this.overflow]);

    // Shadow — literal classes per value
    const shadowNormal = { none: '', sm: 'shadow-sm', md: 'shadow-md', lg: 'shadow-lg', xl: 'shadow-xl' };
    const shadowResponsive = { none: '', sm: 'md:shadow-sm', md: 'md:shadow-md', lg: 'md:shadow-lg', xl: 'md:shadow-xl' };
    const shadowClass = this.responsive ? shadowResponsive[this.shadow] : shadowNormal[this.shadow];
    if (shadowClass) classes.push(shadowClass);

    if (!this.padding) classes.push('p-0');
    if (this.animateOnLoad) classes.push('animate-slide-up-fade-in');
    if (this.customClasses) classes.push(this.customClasses);

    return classes.join(' ');
  }

  /**
   * Explicitly show the header section even without title/subtitle.
   * Useful when using slot="header" for custom header content.
   */
  @Input() showHeader = false;

  get hasHeader(): boolean {
    return !!(this.title || this.subtitle || this.showHeader);
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

  /** Header classes with optional responsive padding */
  get headerClasses(): string {
    const baseClasses = ['border-b', 'border-[var(--color-border)]'];
    if (this.responsivePadding) {
      baseClasses.push('px-4', 'py-3', 'sm:px-6', 'sm:py-4');
    } else {
      baseClasses.push('px-6', 'py-4');
    }
    return baseClasses.join(' ');
  }

  /** Body classes with optional responsive padding */
  get bodyClasses(): string {
    if (!this.padding) return '';
    if (this.responsivePadding) {
      return 'p-4 sm:p-6';
    }
    return 'p-6';
  }

  /** Footer classes with optional responsive padding */
  get footerClasses(): string {
    const baseClasses = [
      'border-t',
      'border-[var(--color-border)]',
      'bg-[var(--color-background)]',
    ];
    if (this.responsivePadding) {
      baseClasses.push('px-4', 'py-3', 'sm:px-6', 'sm:py-4');
    } else {
      baseClasses.push('px-6', 'py-4');
    }
    return baseClasses.join(' ');
  }
}
