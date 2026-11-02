import { Component, input } from '@angular/core';
import { CardComponent, IconComponent } from '../../../../../../shared/components';

/**
 * One section of the customer profile (info and CRM tabs): the same card, header (tinted icon,
 * title, optional hint) and action slot for every block, so the profile reads as
 * one system. Actions go in `[slot=actions]`, the body as default content.
 */
@Component({
  selector: 'app-customer-section',
  standalone: true,
  imports: [CardComponent, IconComponent],
  host: { class: 'block' },
  template: `
    <app-card [fullHeight]="true">
      <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div class="flex min-w-0 items-center gap-2">
          <span
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
            aria-hidden="true"
          >
            <app-icon [name]="icon()" [size]="16"></app-icon>
          </span>
          <div class="min-w-0">
            <h3 class="text-base font-semibold text-text-primary">{{ title() }}</h3>
            @if (hint()) {
              <p class="text-xs text-text-secondary">{{ hint() }}</p>
            }
          </div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <ng-content select="[slot=actions]"></ng-content>
        </div>
      </div>
      <ng-content></ng-content>
    </app-card>
  `,
})
export class CustomerSectionComponent {
  readonly title = input.required<string>();
  readonly icon = input.required<string>();
  readonly hint = input<string | null>(null);
}

/** Empty state inside a profile section: same look in every block. */
@Component({
  selector: 'app-customer-section-empty',
  standalone: true,
  imports: [IconComponent],
  host: { class: 'block' },
  template: `
    <div
      class="flex flex-col items-center gap-1 rounded-xl border border-dashed border-border px-4 py-5 text-center"
    >
      <app-icon [name]="icon()" [size]="16" class="text-muted"></app-icon>
      <p class="text-sm text-text-secondary">{{ text() }}</p>
    </div>
  `,
})
export class CustomerSectionEmptyComponent {
  readonly icon = input('inbox');
  readonly text = input.required<string>();
}
