import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  model,
} from '@angular/core';
import { Router, RouterLink, UrlTree } from '@angular/router';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { EmptyStateComponent } from '../../../../../../shared/components/empty-state/empty-state.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { SpinnerComponent } from '../../../../../../shared/components/spinner/spinner.component';
import { formatStoreDateTime } from '../../../../../../shared/utils/date.util';
import { Reminder } from '../../../dashboard/services/reminders.service';
import { VEX_COPY } from '../../vex-copy';
import { VexLogStore } from '../../state/vex-log.store';
import {
  VEX_REMINDER_FILTERS,
  VexReminderFilter,
} from '../../state/vex-reminders.util';

const EMPTY_TEXT: Record<VexReminderFilter, string> = VEX_COPY.log.empty;

/** Same deep link the reminder notification uses (`REMINDERS_ROUTE` in the backend). */
export const VEX_LOG_DASHBOARD_LINK = '/admin/dashboard';
export const VEX_LOG_DASHBOARD_QUERY = { tab: 'bitacora' } as const;

@Component({
  selector: 'vendix-vex-log-sidebar',
  standalone: true,
  imports: [
    ButtonComponent,
    EmptyStateComponent,
    IconComponent,
    RouterLink,
    SpinnerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full' },
  template: `
    <aside
      id="vex-log-panel"
      [attr.aria-label]="copy.panel_label"
      class="h-full flex flex-col overflow-hidden bg-surface border-l border-border text-text-primary transition-[width] duration-200 motion-reduce:transition-none"
      [class.w-80]="!collapsed()"
      [class.w-14]="collapsed()"
    >
      @if (collapsed()) {
        <div class="flex flex-col items-center gap-1 py-3">
          <button
            type="button"
            class="relative w-10 h-10 flex items-center justify-center rounded-lg text-text-secondary hover:bg-text-primary/5"
            [class]="railButtonClass()"
            [attr.title]="copy.open"
            [attr.aria-label]="railLabel()"
            aria-controls="vex-log-panel"
            [attr.aria-expanded]="false"
            (click)="collapsed.set(false)"
          >
            <app-icon name="panel-right-open" [size]="18" />
            @if (store.pending_count() > 0) {
              <span
                class="absolute top-0.5 right-0.5 min-w-4 h-4 px-1 rounded-full bg-primary text-on-primary text-xs leading-4 text-center"
                [class]="badgePulseClass()"
                aria-hidden="true"
              >
                {{ store.pending_count() }}
              </span>
            }
          </button>
          <span class="sr-only" role="status" aria-live="polite">
            {{ store.highlight() ? copy.saved_notice : '' }}
          </span>
          @for (filter of filters; track filter.key) {
            <button
              type="button"
              class="w-10 h-10 flex items-center justify-center rounded-lg text-text-secondary hover:bg-text-primary/5"
              [attr.title]="filter.label"
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
            <span class="font-semibold truncate">{{ copy.title }}</span>
            @if (store.attention_count() > 0) {
              <span
                class="shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-primary text-on-primary text-xs leading-5 text-center"
                [attr.aria-label]="copy.attention_aria(store.attention_count())"
              >
                {{ store.attention_count() }}
              </span>
            }
          </div>
          <button
            type="button"
            class="w-10 h-10 shrink-0 flex items-center justify-center rounded-lg text-text-secondary hover:bg-text-primary/5"
            [attr.title]="copy.close"
            [attr.aria-label]="copy.close"
            aria-controls="vex-log-panel"
            [attr.aria-expanded]="true"
            (click)="collapsed.set(true)"
          >
            <app-icon name="panel-right-close" [size]="18" />
          </button>
        </div>

        <div
          class="flex gap-2 overflow-x-auto scrollbar-none px-3 pb-2 shrink-0"
          role="group"
          [attr.aria-label]="copy.filter_label"
        >
          @for (filter of filters; track filter.key) {
            <app-button
              class="shrink-0"
              size="sm"
              [variant]="store.active_filter() === filter.key ? 'primary' : 'ghost'"
              [customClasses]="chipClass(store.active_filter() === filter.key)"
              [ariaPressed]="store.active_filter() === filter.key"
              (clicked)="store.setFilter(filter.key)"
            >
              <span>{{ filter.label }}</span>
              <span class="ml-1.5 text-xs opacity-80">{{ store.counts()[filter.key] }}</span>
            </app-button>
          }
        </div>

        <div class="flex-1 overflow-y-auto px-3 pb-3">
          @if (store.loading()) {
            <div class="py-4" role="status">
              <app-spinner size="sm" [text]="copy.loading" [center]="true" />
            </div>
          } @else if (store.error()) {
            <div class="py-4 flex flex-col items-start gap-2">
              <p class="text-sm text-text-secondary">
                {{ copy.error }}
              </p>
              <app-button
                variant="ghost"
                size="sm"
                customClasses="min-h-10"
                (clicked)="store.refresh()"
              >
                {{ copy.retry }}
              </app-button>
            </div>
          } @else {
            @for (item of store.filtered(); track item.id) {
              <div
                class="flex gap-3 py-3 border-b border-border last:border-b-0"
                [class.opacity-60]="item.status === 'done'"
              >
                <button
                  type="button"
                  class="mt-0.5 shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors motion-reduce:transition-none disabled:opacity-50"
                  [class]="checkClass(item)"
                  [disabled]="store.updating_ids().has(item.id)"
                  [attr.aria-label]="item.status === 'done' ? copy.reopen : copy.mark_done"
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
                        class="shrink-0 text-xs font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary"
                      >
                        {{ copy.brand }}
                      </span>
                    }
                  </div>
                  @if (item.note) {
                    <p class="text-sm text-text-secondary line-clamp-2 break-words">
                      {{ item.note }}
                    </p>
                  }
                  <div class="flex items-center gap-3 flex-wrap mt-1 text-xs text-text-secondary">
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
                          <a [routerLink]="linkTree" class="text-primary hover:underline truncate">
                            {{ item.link.type_label }} · {{ item.link.label }}
                          </a>
                        } @else {
                          <span class="truncate">{{ item.link.type_label }} · {{ item.link.label }}</span>
                          <span class="shrink-0 italic">{{ copy.link_unavailable }}</span>
                        }
                      </span>
                    }
                  </div>
                </div>
              </div>
            } @empty {
              <app-empty-state
                size="xsm"
                icon="notebook-pen"
                [title]="emptyText(store.active_filter())"
                description=""
                [showActionButton]="false"
              />
            }
          }
        </div>

        <div class="px-3 py-2 border-t border-border shrink-0">
          <a
            [routerLink]="dashboardLink"
            [queryParams]="dashboardQuery"
            class="min-h-10 flex items-center gap-1.5 text-sm text-primary hover:underline"
          >
            <app-icon name="external-link" [size]="14" />
            {{ copy.manage }}
          </a>
        </div>
      }
    </aside>
  `,
})
export class VexLogSidebarComponent {
  protected readonly copy = VEX_COPY.log;
  readonly store = inject(VexLogStore);
  private readonly router = inject(Router);

  readonly collapsed = model<boolean>(false);

  readonly filters = VEX_REMINDER_FILTERS;
  readonly dashboardLink = VEX_LOG_DASHBOARD_LINK;
  readonly dashboardQuery = VEX_LOG_DASHBOARD_QUERY;

  readonly railLabel = computed(() => {
    const count = this.store.pending_count();
    return VEX_COPY.page.open_log_pending(count);
  });

  readonly badgePulseClass = computed(() =>
    this.store.highlight() ? 'animate-pulse motion-reduce:animate-none' : '',
  );

  /** A new reminder briefly rings the rail button; the ring stays under reduced motion. */
  readonly railButtonClass = computed(() =>
    this.store.highlight() ? 'ring-2 ring-primary' : '',
  );

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
    if (item.bucket === 'overdue') return 'text-error';
    if (item.bucket === 'today') return 'text-primary';
    return '';
  }

  checkClass(item: Reminder): string {
    return item.status === 'done'
      ? 'bg-primary border-primary text-on-primary'
      : 'border-border hover:border-primary';
  }

  chipClass(active: boolean): string {
    return active
      ? 'min-h-10 !rounded-full'
      : 'min-h-10 !rounded-full border border-border !text-text-secondary';
  }

  onFilter(filter: VexReminderFilter): void {
    this.store.setFilter(filter);
    this.collapsed.set(false);
  }
}
