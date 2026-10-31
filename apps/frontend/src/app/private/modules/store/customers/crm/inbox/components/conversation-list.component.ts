import { Component, computed, input, model, output } from '@angular/core';
import {
  BadgeComponent,
  EmptyStateComponent,
  IconComponent,
  InputsearchComponent,
  ScrollableTabsComponent,
} from '../../../../../../../shared/components';
import type { ScrollableTab } from '../../../../../../../shared/components';
import { CrmConversation } from '../crm-inbox.interface';
import {
  CHANNEL_META,
  CONVERSATION_STATUS_META,
  conversationTitle,
  initials,
  listTimeLabel,
  personName,
} from '../crm-inbox.utils';

export type InboxFilter = 'all' | 'unassigned' | 'mine' | 'open' | 'closed';

const FILTER_TABS: ScrollableTab[] = [
  { id: 'all', label: 'Todas' },
  { id: 'unassigned', label: 'Sin asignar' },
  { id: 'mine', label: 'Mías' },
  { id: 'open', label: 'Abiertas' },
  { id: 'closed', label: 'Cerradas' },
];

/** Left pane of the inbox: filters, search and the conversation rows. */
@Component({
  selector: 'app-crm-conversation-list',
  standalone: true,
  imports: [
    BadgeComponent,
    EmptyStateComponent,
    IconComponent,
    InputsearchComponent,
    ScrollableTabsComponent,
  ],
  template: `
    <div class="flex h-full min-h-0 flex-col">
      <div class="flex flex-col gap-3 border-b border-[var(--color-border)] p-3">
        <app-inputsearch
          placeholder="Buscar por nombre o teléfono"
          ariaLabel="Buscar conversaciones"
          [debounceTime]="350"
          (searchChange)="search.emit($event)"
        ></app-inputsearch>
        <app-scrollable-tabs
          [tabs]="tabs()"
          [activeTab]="filter()"
          size="sm"
          ariaLabel="Filtrar conversaciones"
          (tabChange)="filter.set($any($event))"
        ></app-scrollable-tabs>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto" role="list">
        @if (error()) {
          <div class="p-4">
            <app-empty-state
              size="sm"
              icon="triangle-alert"
              iconColor="error"
              title="No pudimos cargar las conversaciones"
              [description]="error() ?? ''"
              [showActionButton]="false"
              [showRefreshButton]="true"
              (refreshClick)="retry.emit()"
            ></app-empty-state>
          </div>
        } @else if (loading() && conversations().length === 0) {
          @for (row of skeletonRows; track row) {
            <div class="flex animate-pulse gap-3 p-3">
              <div class="h-10 w-10 rounded-full bg-[var(--color-surface-muted)]"></div>
              <div class="flex-1 space-y-2 py-1">
                <div class="h-3 w-2/3 rounded-full bg-[var(--color-surface-muted)]"></div>
                <div class="h-3 w-1/2 rounded-full bg-[var(--color-surface-muted)]"></div>
              </div>
            </div>
          }
        } @else if (conversations().length === 0) {
          <div class="p-4">
            <app-empty-state
              size="sm"
              icon="inbox"
              [title]="emptyTitle()"
              [description]="emptyDescription()"
              [showActionButton]="false"
              [showClearFilters]="hasFilters()"
              (clearFiltersClick)="clearFilters.emit()"
            ></app-empty-state>
          </div>
        } @else {
          @for (conversation of conversations(); track conversation.id) {
            <button
              type="button"
              role="listitem"
              class="flex w-full items-start gap-3 border-b border-[var(--color-border)] px-3 py-3 text-left transition-colors hover:bg-primary/5 focus-visible:bg-primary/10 focus-visible:outline-none"
              [class.bg-primary/10]="conversation.id === selectedId()"
              [attr.aria-current]="conversation.id === selectedId() ? 'true' : null"
              (click)="selected.emit(conversation.id)"
            >
              <div
                class="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
                aria-hidden="true"
              >
                {{ avatar(conversation) }}
                <span
                  class="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--color-border)] bg-surface text-[var(--color-text-secondary)]"
                >
                  <app-icon [name]="channelIcon(conversation)" [size]="12"></app-icon>
                </span>
              </div>
              <div class="min-w-0 flex-1">
                <div class="flex items-baseline justify-between gap-2">
                  <p
                    class="truncate text-sm text-[var(--color-text-primary)]"
                    [class.font-bold]="conversation.unread_count > 0"
                    [class.font-semibold]="conversation.unread_count === 0"
                  >
                    {{ title(conversation) }}
                  </p>
                  <span class="shrink-0 text-xs text-[var(--color-text-secondary)]">
                    {{ time(conversation) }}
                  </span>
                </div>
                <div class="mt-1 flex items-center justify-between gap-2">
                  <p class="truncate text-xs text-[var(--color-text-secondary)]">
                    @if (conversation.last_message_preview?.direction === 'outbound') {
                      <span class="font-semibold">Tú: </span>
                    }
                    {{ conversation.last_message_preview?.text || 'Sin mensajes' }}
                  </p>
                  @if (conversation.unread_count > 0) {
                    <span
                      class="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-bold text-on-primary"
                      [attr.aria-label]="conversation.unread_count + ' sin leer'"
                    >
                      {{ conversation.unread_count }}
                    </span>
                  }
                </div>
                <div class="mt-2 flex flex-wrap items-center gap-2">
                  @if (conversation.status === 'closed') {
                    <app-badge variant="neutral" size="xsm">
                      {{ statusLabel(conversation) }}
                    </app-badge>
                  }
                  <span class="truncate text-xs text-[var(--color-text-secondary)]">
                    {{ assigneeLabel(conversation) }}
                  </span>
                </div>
              </div>
            </button>
          }
          @if (hasMore()) {
            <div class="p-3">
              <button
                type="button"
                class="h-10 w-full rounded-xl border border-[var(--color-border)] text-sm font-semibold text-primary hover:bg-primary/5 disabled:opacity-60"
                [disabled]="loadingMore()"
                (click)="loadMore.emit()"
              >
                {{ loadingMore() ? 'Cargando…' : 'Cargar más' }}
              </button>
            </div>
          }
        }
      </div>
    </div>
  `,
})
export class ConversationListComponent {
  readonly conversations = input.required<CrmConversation[]>();
  readonly selectedId = input<number | null>(null);
  readonly loading = input(false);
  readonly loadingMore = input(false);
  readonly hasMore = input(false);
  readonly error = input<string | null>(null);
  readonly searchText = input('');
  /** Users without `crm_inbox:assign` only see their own: hide "Sin asignar". */
  readonly canSeeAll = input(true);
  readonly filter = model<InboxFilter>('all');

  readonly selected = output<number>();
  readonly search = output<string>();
  readonly loadMore = output<void>();
  readonly retry = output<void>();
  readonly clearFilters = output<void>();

  protected readonly skeletonRows = [1, 2, 3, 4, 5];

  protected readonly tabs = computed(() =>
    this.canSeeAll()
      ? FILTER_TABS
      : FILTER_TABS.filter((tab) => tab.id !== 'unassigned'),
  );

  protected readonly hasFilters = computed(
    () => this.filter() !== 'all' || this.searchText().trim() !== '',
  );

  protected readonly emptyTitle = computed(() =>
    this.hasFilters() ? 'Sin resultados' : 'Aún no hay conversaciones',
  );

  protected readonly emptyDescription = computed(() =>
    this.hasFilters()
      ? 'Ninguna conversación coincide con el filtro o la búsqueda.'
      : this.canSeeAll()
        ? 'Cuando un cliente te escriba por WhatsApp, SMS o correo, la conversación aparecerá aquí.'
        : 'Aquí verás las conversaciones que te asignen.',
  );

  protected title(conversation: CrmConversation): string {
    return conversationTitle(conversation);
  }

  protected avatar(conversation: CrmConversation): string {
    return initials(conversationTitle(conversation));
  }

  protected channelIcon(conversation: CrmConversation): string {
    return CHANNEL_META[conversation.channel]?.icon ?? 'message-circle';
  }

  protected time(conversation: CrmConversation): string {
    return listTimeLabel(conversation.last_message_at ?? conversation.created_at);
  }

  protected statusLabel(conversation: CrmConversation): string {
    return CONVERSATION_STATUS_META[conversation.status]?.label ?? conversation.status;
  }

  protected assigneeLabel(conversation: CrmConversation): string {
    const name = personName(conversation.assigned_user);
    return name ? `Responsable: ${name}` : 'Sin asignar';
  }
}
