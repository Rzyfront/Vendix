import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  model,
} from '@angular/core';
import { Router, RouterLink, UrlTree } from '@angular/router';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { formatStoreDateTime } from '../../../../../../shared/utils/date.util';
import { Reminder } from '../../../dashboard/services/reminders.service';
import { VexLogStore } from '../../state/vex-log.store';
import {
  VEX_REMINDER_FILTERS,
  VexReminderFilter,
} from '../../state/vex-reminders.util';

const EMPTY_TEXT: Record<VexReminderFilter, string> = {
  pending: 'No tienes recordatorios pendientes',
  today: 'Nada para hoy',
  overdue: 'No tienes recordatorios vencidos',
  upcoming: 'Sin recordatorios próximos',
  done: 'Aún no has completado recordatorios',
};

/** Same deep link the reminder notification uses (`REMINDERS_ROUTE` in the backend). */
export const VEX_LOG_DASHBOARD_LINK = '/admin/dashboard';
export const VEX_LOG_DASHBOARD_QUERY = { tab: 'bitacora' } as const;

@Component({
  selector: 'vendix-vex-log-sidebar',
  standalone: true,
  imports: [IconComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full' },
  template: `
    <aside
      class="h-full flex flex-col overflow-hidden bg-[var(--color-surface)] border-l border-[var(--color-border)] text-[var(--color-text-primary)] transition-[width] duration-200 motion-reduce:transition-none"
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
            @if (store.attention_count() > 0) {
              <span
                class="absolute top-0.5 right-0.5 min-w-4 h-4 px-1 rounded-full bg-[var(--color-primary)] text-[var(--color-text-on-primary)] text-[10px] leading-4 text-center"
              >
                {{ store.attention_count() }}
              </span>
            }
          </button>
          @for (filter of filters; track filter.key) {
            <button
              type="button"
              class="w-10 h-10 flex items-center justify-center rounded-lg text-[var(--color-text-secondary)] hover:bg-[rgba(var(--color-text-primary-rgb),0.06)]"
              [title]="filter.label"
              [attr.aria-label]="filter.label"
              (click)="onFilter(filter.key)"
            >
              <app-icon [name]="filter.icon" [size]="18" />
            </button>
          }
        </div>
      } @else {
        <div class="flex items-center justify-between gap-2 px-3 py-3 shrink-0">
          <div class="flex items-center gap-2 min-w-0">
            <app-icon name="notebook-pen" [size]="18" />
            <span class="font-semibold truncate">Bitácora empresarial</span>
            @if (store.attention_count() > 0) {
              <span
                class="shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-[var(--color-primary)] text-[var(--color-text-on-primary)] text-xs leading-5 text-center"
                [attr.aria-label]="store.attention_count() + ' para hoy o vencidos'"
              >
                {{ store.attention_count() }}
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

        <div
          class="flex gap-2 overflow-x-auto scrollbar-none px-3 pb-2 shrink-0"
          role="group"
          aria-label="Filtrar recordatorios"
        >
          @for (filter of filters; track filter.key) {
            <button
              type="button"
              class="shrink-0 min-h-10 px-3 rounded-full text-sm border flex items-center gap-1.5"
              [class]="chipClass(store.active_filter() === filter.key)"
              [attr.aria-pressed]="store.active_filter() === filter.key"
              (click)="store.setFilter(filter.key)"
            >
              <span>{{ filter.label }}</span>
              <span class="text-xs opacity-80">{{ store.counts()[filter.key] }}</span>
            </button>
          }
        </div>

        <div class="flex-1 overflow-y-auto px-3 pb-3">
          @if (store.loading()) {
            <p class="py-4 text-sm text-[var(--color-text-secondary)]">Cargando recordatorios…</p>
          } @else if (store.error()) {
            <div class="py-4 flex flex-col items-start gap-2">
              <p class="text-sm text-[var(--color-text-secondary)]">
                No se pudieron cargar los recordatorios
              </p>
              <button
                type="button"
                class="min-h-10 text-sm text-[var(--color-primary)] hover:underline"
                (click)="store.refresh()"
              >
                Reintentar
              </button>
            </div>
          } @else {
            @for (item of store.filtered(); track item.id) {
              <div
                class="flex gap-3 py-3 border-b border-[var(--color-border)] last:border-b-0"
                [class.opacity-60]="item.status === 'done'"
              >
                <button
                  type="button"
                  class="mt-0.5 shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors motion-reduce:transition-none disabled:opacity-50"
                  [class]="checkClass(item)"
                  [disabled]="store.updating_ids().has(item.id)"
                  [attr.aria-label]="item.status === 'done' ? 'Reabrir recordatorio' : 'Marcar como hecho'"
                  (click)="store.toggleStatus(item)"
                >
                  @if (item.status === 'done') {
                    <app-icon name="check" [size]="14" />
                  }
                </button>
                <div class="min-w-0 flex-1">
                  <div class="flex items-start justify-between gap-2">
                    <p class="text-sm font-medium break-words" [class.line-through]="item.status === 'done'">
                      {{ item.title }}
                    </p>
                    @if (item.source === 'vex') {
                      <span
                        class="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[rgba(var(--color-primary-rgb),0.12)] text-[var(--color-primary)]"
                      >
                        Vex
                      </span>
                    }
                  </div>
                  @if (item.note) {
                    <p class="text-sm text-[var(--color-text-secondary)] line-clamp-2 break-words">
                      {{ item.note }}
                    </p>
                  }
                  <div class="flex items-center gap-3 flex-wrap mt-1 text-xs text-[var(--color-text-secondary)]">
                    @if (item.remind_at) {
                      <span class="flex items-center gap-1" [class]="dueClass(item)">
                        <app-icon name="clock" [size]="12" />
                        {{ formatDue(item.remind_at) }}
                      </span>
                    }
                    @if (item.link) {
                      <span class="flex items-center gap-1 min-w-0">
                        <app-icon name="link" [size]="12" />
                        @if (linkTrees().get(item.id); as linkTree) {
                          <a [routerLink]="linkTree" class="text-[var(--color-primary)] hover:underline truncate">
                            {{ item.link.type_label }} · {{ item.link.label }}
                          </a>
                        } @else {
                          <span class="truncate">{{ item.link.type_label }} · {{ item.link.label }}</span>
                          <span class="shrink-0 italic">(no disponible)</span>
                        }
                      </span>
                    }
                  </div>
                </div>
              </div>
            } @empty {
              <p class="py-4 text-sm text-[var(--color-text-secondary)]">
                {{ emptyText(store.active_filter()) }}
              </p>
            }
          }
        </div>

        <div class="px-3 py-2 border-t border-[var(--color-border)] shrink-0">
          <a
            [routerLink]="dashboardLink"
            [queryParams]="dashboardQuery"
            class="min-h-10 flex items-center gap-1.5 text-sm text-[var(--color-primary)] hover:underline"
          >
            <app-icon name="external-link" [size]="14" />
            Gestionar en el panel
          </a>
        </div>
      }
    </aside>
  `,
})
export class VexLogSidebarComponent {
  readonly store = inject(VexLogStore);
  private readonly router = inject(Router);

  readonly collapsed = model<boolean>(false);

  readonly filters = VEX_REMINDER_FILTERS;
  readonly dashboardLink = VEX_LOG_DASHBOARD_LINK;
  readonly dashboardQuery = VEX_LOG_DASHBOARD_QUERY;

  /**
   * Parsed routes of the links the user may open, by reminder id. A plain
   * string in `routerLink` would encode a query such as `?invoiceId=`.
   */
  readonly linkTrees = computed(() => {
    const trees = new Map<number, UrlTree>();
    for (const item of this.store.filtered()) {
      if (item.link?.available && item.link.url) {
        trees.set(item.id, this.router.parseUrl(item.link.url));
      }
    }
    return trees;
  });

  /** Due instants render in the store zone, the same clock as the dashboard Bitácora. */
  formatDue(remind_at: string): string {
    return formatStoreDateTime(remind_at, this.store.timezone());
  }

  emptyText(filter: VexReminderFilter): string {
    return EMPTY_TEXT[filter];
  }

  dueClass(item: Reminder): string {
    if (item.status !== 'pending') return '';
    if (item.bucket === 'overdue') return 'text-[var(--color-error)]';
    if (item.bucket === 'today') return 'text-[var(--color-primary)]';
    return '';
  }

  checkClass(item: Reminder): string {
    return item.status === 'done'
      ? 'bg-[var(--color-primary)] border-[var(--color-primary)] text-[var(--color-text-on-primary)]'
      : 'border-[var(--color-border)] hover:border-[var(--color-primary)]';
  }

  chipClass(active: boolean): string {
    return active
      ? 'bg-[var(--color-primary)] text-[var(--color-text-on-primary)] border-transparent'
      : 'border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[rgba(var(--color-text-primary-rgb),0.06)]';
  }

  onFilter(filter: VexReminderFilter): void {
    this.store.setFilter(filter);
    this.collapsed.set(false);
  }
}
