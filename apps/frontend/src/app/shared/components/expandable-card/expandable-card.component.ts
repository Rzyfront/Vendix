import {
  Component,
  ChangeDetectionStrategy,
  input,
  model,
} from '@angular/core';

import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'app-expandable-card',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="expandable-card"
      [class.expanded]="expanded()"
      [class.disabled]="disabled()"
    >
      <!-- Header: always visible, clickable -->
      <button
        type="button"
        class="expandable-card__header"
        [attr.aria-expanded]="expanded()"
        [disabled]="disabled()"
        (click)="toggle()"
      >
        <div class="expandable-card__header-content">
          <ng-content select="[slot=header]" />
        </div>
        <div
          class="expandable-card__header-actions"
          (click)="$event.stopPropagation()"
        >
          <ng-content select="[slot=actions]" />
        </div>
        <app-icon
          name="chevron-down"
          [size]="20"
          class="expandable-card__chevron"
          [class.rotate-180]="expanded()"
        />
      </button>

      <!-- Body: expandable content -->
      @if (expanded()) {
        <div class="expandable-card__body">
          <div class="expandable-card__divider"></div>
          <ng-content />
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .expandable-card {
      background: var(--color-surface, white);
      border: 1px solid var(--color-border, #e2e8f0);
      border-radius: 0.75rem;
      overflow: hidden;
      transition: box-shadow 200ms ease;

      &:hover:not(.disabled) {
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
      }

      &.expanded {
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.07);
      }

      &.disabled {
        opacity: 0.6;
        pointer-events: none;
      }
    }

    .expandable-card__header {
      display: flex;
      align-items: center;
      width: 100%;
      gap: 1rem;
      padding: 0.75rem 1rem;
      border: none;
      background: none;
      cursor: pointer;
      text-align: left;
      font: inherit;
      color: inherit;
      min-height: 44px;

      @media (min-width: 768px) {
        padding: 1rem 1.25rem;
      }

      &:focus-visible {
        outline: 2px solid var(--color-primary, #6366f1);
        outline-offset: -2px;
        border-radius: 0.75rem;
      }
    }

    .expandable-card__header-content {
      flex: 1;
      min-width: 0;
    }

    .expandable-card__header-actions {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-shrink: 0;
    }

    .expandable-card__chevron {
      flex-shrink: 0;
      color: var(--color-text-secondary, #64748b);
      transition: transform 200ms ease;

      &.rotate-180 {
        transform: rotate(180deg);
      }
    }

    .expandable-card__divider {
      height: 1px;
      background: var(--color-border, #e2e8f0);
    }

    .expandable-card__body {
      animation: expandIn 200ms ease-out;
    }

    @keyframes expandIn {
      from {
        opacity: 0;
        transform: translateY(-4px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .expandable-card__chevron {
        transition: none;
      }
      .expandable-card__body {
        animation: none;
      }
    }
  `,
})
export class ExpandableCardComponent {
  readonly expanded = model<boolean>(false);
  readonly disabled = input<boolean>(false);

  toggle(): void {
    if (!this.disabled()) {
      this.expanded.update(v => !v);
    }
  }
}
