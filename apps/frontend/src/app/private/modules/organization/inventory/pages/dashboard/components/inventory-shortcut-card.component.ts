import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';

import { BadgeComponent } from '../../../../../../../shared/components/badge/badge.component';
import { CardComponent } from '../../../../../../../shared/components/card/card.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { IconName } from '../../../../../../../shared/components/icon/icons.registry';

/**
 * Color hint for the count badge inside an inventory shortcut card. Maps to the
 * shared `BadgeVariant` palette via `badgeVariant` getter.
 */
export type InventoryShortcutBadgeColor = 'red' | 'amber' | 'emerald' | 'gray';

/**
 * Reusable shortcut card for the ORG_ADMIN inventory dashboard. Each instance
 * advertises one inventory section (stock, locations, suppliers, etc.) and
 * deep-links into it via `routerLink`.
 *
 * Layout: icon block + title + descripción on the left, count badge + chevron
 * on the right. The whole card is an `<a>` link so the entire surface is a
 * single tap target (≥44px tall) — works on touch and keyboard.
 */
@Component({
  selector: 'vendix-inventory-shortcut-card',
  standalone: true,
  imports: [RouterLink, CardComponent, IconComponent, BadgeComponent],
  template: `
    <a
      [routerLink]="routerLink()"
      class="block focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-[var(--radius-lg)]"
      [attr.aria-label]="title() + ' — ' + description()"
    >
      <app-card
        [responsive]="false"
        [padding]="false"
        customClasses="hover:shadow-md transition-shadow duration-150 cursor-pointer"
      >
        <div
          class="flex items-center gap-3 p-4 min-h-[88px] md:min-h-[96px]"
        >
          <div
            [class]="
              'flex-shrink-0 w-11 h-11 md:w-12 md:h-12 rounded-lg flex items-center justify-center ' +
              iconBgColor()
            "
          >
            <app-icon
              [name]="icon()"
              [size]="22"
              [class]="iconColor()"
            ></app-icon>
          </div>

          <div class="flex-1 min-w-0">
            <h3
              class="text-sm md:text-base font-semibold text-text-primary truncate"
            >
              {{ title() }}
            </h3>
            <p
              class="text-xs md:text-sm text-text-secondary mt-0.5 truncate"
            >
              {{ description() }}
            </p>
          </div>

          <div class="flex-shrink-0 flex items-center gap-2">
            @if (count() !== null && count() !== undefined) {
              <app-badge
                [variant]="badgeVariant()"
                size="sm"
                badgeStyle="solid"
              >
                {{ count() }}
              </app-badge>
            }
            <app-icon
              name="chevron-right"
              [size]="18"
              class="text-text-secondary"
            ></app-icon>
          </div>
        </div>
      </app-card>
    </a>
  `,
})
export class InventoryShortcutCardComponent {
  readonly title = input.required<string>();
  readonly icon = input.required<IconName>();
  readonly description = input.required<string>();
  readonly routerLink = input.required<string>();
  readonly count = input<number | null | undefined>(undefined);
  readonly badgeColor = input<InventoryShortcutBadgeColor>('gray');
  readonly iconBgColor = input<string>('bg-blue-100');
  readonly iconColor = input<string>('text-blue-500');

  readonly badgeVariant = computed(() => {
    switch (this.badgeColor()) {
      case 'red':
        return 'error' as const;
      case 'amber':
        return 'warning' as const;
      case 'emerald':
        return 'success' as const;
      case 'gray':
      default:
        return 'neutral' as const;
    }
  });
}
