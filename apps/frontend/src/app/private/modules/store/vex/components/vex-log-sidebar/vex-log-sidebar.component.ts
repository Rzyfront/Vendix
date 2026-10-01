import {
  ChangeDetectionStrategy,
  Component,
  inject,
  model,
} from '@angular/core';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { formatStoreDateTime } from '../../../../../../shared/utils/date.util';
import {
  VEX_LOG_CATEGORY_META,
  VexLogCategory,
} from '../../models/vex.models';
import { VexLogStore } from '../../state/vex-log.store';

interface VexLogCategoryItem {
  key: VexLogCategory;
  label: string;
  icon: string;
}

const CATEGORY_TINT: Record<VexLogCategory, string> = {
  sale: 'bg-[rgba(var(--color-success-rgb),0.15)] text-[var(--color-success)]',
  inventory: 'bg-[rgba(var(--color-warning-rgb),0.15)] text-[var(--color-warning)]',
  cash: 'bg-[rgba(var(--color-info-rgb),0.15)] text-[var(--color-info)]',
  alert: 'bg-[rgba(var(--color-error-rgb),0.15)] text-[var(--color-error)]',
  agent: 'bg-[rgba(var(--color-primary-rgb),0.12)] text-[var(--color-primary)]',
};

@Component({
  selector: 'vendix-vex-log-sidebar',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full' },
  template: `
    <aside
      class="h-full flex flex-col overflow-hidden bg-[var(--color-surface)] border-l border-[var(--color-border)] text-[var(--color-text-primary)] transition-[width] duration-200"
      [class.w-80]="!collapsed()"
      [class.w-14]="collapsed()"
    >
      @if (collapsed()) {
        <div class="flex flex-col items-center gap-1 py-3">
          <button
            type="button"
            class="relative w-10 h-10 flex items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[rgba(var(--color-text-primary-rgb),0.06)]"
            title="Expandir bitácora"
            aria-label="Expandir bitácora"
            (click)="collapsed.set(false)"
          >
            <app-icon name="panel-right-open" [size]="18" />
            @if (store.new_count() > 0) {
              <span
                class="absolute top-0.5 right-0.5 min-w-4 h-4 px-1 rounded-full bg-[var(--color-primary)] text-[var(--color-text-on-primary)] text-[10px] leading-4 text-center"
              >
                {{ store.new_count() }}
              </span>
            }
          </button>
          @for (cat of categories; track cat.key) {
            <button
              type="button"
              class="w-10 h-10 flex items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[rgba(var(--color-text-primary-rgb),0.06)]"
              [title]="cat.label"
              [attr.aria-label]="cat.label"
              (click)="onCategory(cat.key)"
            >
              <app-icon [name]="cat.icon" [size]="18" />
            </button>
          }
        </div>
      } @else {
        <div class="flex items-center justify-between gap-2 px-3 py-3 shrink-0">
          <div class="flex items-center gap-2 min-w-0">
            <app-icon name="history" [size]="18" />
            <span class="font-semibold truncate">Bitácora empresarial</span>
            @if (store.new_count() > 0) {
              <span
                class="shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-[var(--color-primary)] text-[var(--color-text-on-primary)] text-xs leading-5 text-center"
              >
                {{ store.new_count() }}
              </span>
            }
          </div>
          <button
            type="button"
            class="w-10 h-10 shrink-0 flex items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[rgba(var(--color-text-primary-rgb),0.06)]"
            aria-label="Contraer bitácora"
            (click)="collapsed.set(true)"
          >
            <app-icon name="panel-right-close" [size]="18" />
          </button>
        </div>

        <div class="flex gap-2 overflow-x-auto scrollbar-none px-3 pb-2 shrink-0">
          <button
            type="button"
            class="shrink-0 min-h-10 px-3 rounded-full text-sm border"
            [class]="chipClass(store.active_filter() === 'all')"
            (click)="store.setFilter('all')"
          >
            Todo
          </button>
          @for (cat of categories; track cat.key) {
            <button
              type="button"
              class="shrink-0 min-h-10 px-3 rounded-full text-sm border flex items-center gap-1.5"
              [class]="chipClass(store.active_filter() === cat.key)"
              (click)="store.setFilter(cat.key)"
            >
              <app-icon [name]="cat.icon" [size]="14" />
              <span>{{ cat.label }}</span>
            </button>
          }
        </div>

        @if (store.new_count() > 0) {
          <div class="px-3 pb-2 shrink-0">
            <button
              type="button"
              class="min-h-10 text-sm text-[var(--color-primary)] hover:underline"
              (click)="store.markAllSeen()"
            >
              Marcar como vistos
            </button>
          </div>
        }

        <div class="flex-1 overflow-y-auto px-3 pb-3">
          @for (event of store.filtered_events(); track event.id) {
            <div class="flex gap-3 py-3 border-b border-[var(--color-border)] last:border-b-0">
              <div
                class="w-9 h-9 shrink-0 rounded-full flex items-center justify-center"
                [class]="tint(event.category)"
              >
                <app-icon [name]="meta[event.category].icon" [size]="16" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-start justify-between gap-2">
                  <p class="text-sm font-medium">{{ event.title }}</p>
                  <div class="shrink-0 flex items-center gap-1.5">
                    @if (event.is_new) {
                      <span class="w-2 h-2 rounded-full bg-[var(--color-primary)]" aria-label="Nuevo"></span>
                    }
                    <span class="text-xs text-[var(--color-text-secondary)]">
                      {{ formatTime(event.created_at) }}
                    </span>
                  </div>
                </div>
                <p class="text-sm text-[var(--color-text-secondary)] line-clamp-2">
                  {{ event.description }}
                </p>
              </div>
            </div>
          } @empty {
            <p class="py-4 text-sm text-[var(--color-text-secondary)]">
              Sin eventos para este filtro
            </p>
          }
        </div>
      }
    </aside>
  `,
})
export class VexLogSidebarComponent {
  readonly store = inject(VexLogStore);

  readonly collapsed = model<boolean>(false);

  readonly meta = VEX_LOG_CATEGORY_META;
  readonly categories: VexLogCategoryItem[] = (
    Object.keys(VEX_LOG_CATEGORY_META) as VexLogCategory[]
  ).map((key) => ({ key, ...VEX_LOG_CATEGORY_META[key] }));

  tint(category: VexLogCategory): string {
    return CATEGORY_TINT[category];
  }

  /**
   * Feed instants render in the STORE zone, never the browser's — the same
   * clock the POS prints. `formatStoreDateTime` with explicit time options
   * keeps the `HH:mm` shape already on screen and only changes the zone.
   */
  formatTime(created_at: Date): string {
    return formatStoreDateTime(created_at, this.store.timezone(), {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  chipClass(active: boolean): string {
    return active
      ? 'bg-[var(--color-primary)] text-[var(--color-text-on-primary)] border-transparent'
      : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[rgba(var(--color-text-primary-rgb),0.06)]';
  }

  onCategory(category: VexLogCategory): void {
    this.store.setFilter(category);
    this.collapsed.set(false);
  }
}
