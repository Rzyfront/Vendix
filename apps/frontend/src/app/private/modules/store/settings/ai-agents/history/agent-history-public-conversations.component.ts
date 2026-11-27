import { Component, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  PaginationComponent,
  ResponsiveDataViewComponent,
} from '../../../../../../shared/components/index';
import type {
  ItemListCardConfig,
  TableColumn,
} from '../../../../../../shared/components/index';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';
import {
  AgentHistoryApiService,
  HistoryPublicConversation,
  HistoryPublicMessage,
} from './agent-history.service';
import { formatHistoryDate } from './history-format';

interface PublicConversationRow {
  id: string;
  app: string;
  visitor: string;
  messages: number;
  last: string;
  created: string;
}

const APP_LABEL: Record<string, string> = {
  STORE_ECOMMERCE: 'Tienda en línea',
  STORE_PRODUCT_PAGE: 'Página de producto',
  STORE_SERVICE_PAGE: 'Página de servicios',
};

/**
 * «Historial → Clientes» (Vexi público F2): the store's customer chats with
 * Vexi on the public apps. Read-only: the owner can open one and read it,
 * never reply, edit or delete. Visitors accepted the data notice first (D6).
 */
@Component({
  selector: 'app-agent-history-public-conversations',
  standalone: true,
  imports: [ResponsiveDataViewComponent, PaginationComponent],
  template: `
    <p class="text-sm text-[var(--color-text-secondary)] mb-4">
      Lo que tus clientes hablaron con Vexi en tus apps públicas. Solo lectura.
    </p>

    @if (error()) {
      <p class="text-sm text-[var(--color-error)]" role="alert">{{ error() }}</p>
    }

    @if (selected(); as conversation) {
      <div class="mb-4 rounded-lg border border-[var(--color-border)] p-3" data-testid="public-conversation-detail">
        <div class="mb-2 flex items-center justify-between">
          <p class="text-sm font-semibold">Conversación</p>
          <button type="button" class="text-sm text-[var(--color-primary)]" (click)="selected.set(null)">
            Cerrar
          </button>
        </div>
        <div class="max-h-96 space-y-2 overflow-y-auto">
          @for (message of conversation.messages; track $index) {
            <div class="flex" [class.justify-end]="message.role === 'user'">
              <div
                class="max-w-[85%] whitespace-pre-line rounded-lg px-3 py-2 text-sm"
                [class.bg-[var(--color-background)]]="message.role === 'assistant'"
                [class.bg-emerald-50]="message.role === 'user'"
              >
                <p class="mb-1 text-xs text-[var(--color-text-secondary)]">
                  {{ message.role === 'user' ? 'Cliente' : 'Vexi' }} · {{ date(message.created_at) }}
                </p>
                {{ message.content }}
                @if (message.cards) {
                  <p class="mt-1 text-xs text-[var(--color-text-secondary)]">(Vexi mostró una tarjeta de propuesta)</p>
                }
              </div>
            </div>
          } @empty {
            <p class="text-sm text-[var(--color-text-secondary)]">Sin mensajes.</p>
          }
        </div>
      </div>
    }

    <app-responsive-data-view
      [data]="rows()"
      [columns]="columns"
      [cardConfig]="cardConfig"
      [loading]="loading()"
      emptyIcon="message-square"
      emptyMessage="Todavía no hay conversaciones de clientes"
      emptyTitle="Sin conversaciones"
      emptyDescription="Cuando publiques a Vexi en tus apps, aquí verás lo que tus clientes le escribieron."
      (rowClick)="open($event)"
    />

    <div class="mt-4">
      <app-pagination
        [currentPage]="page()"
        [totalPages]="totalPages()"
        [total]="total()"
        [limit]="limit"
        infoStyle="range"
        (pageChange)="goTo($event)"
      />
    </div>
  `,
  styles: [':host { display: block; width: 100%; }'],
})
export class AgentHistoryPublicConversationsComponent {
  private readonly api = inject(AgentHistoryApiService);

  readonly limit = 20;
  readonly page = signal(1);
  readonly total = signal(0);
  readonly items = signal<HistoryPublicConversation[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly selected = signal<{ id: string; messages: HistoryPublicMessage[] } | null>(null);

  readonly totalPages = computed(() => Math.ceil(this.total() / this.limit));
  readonly rows = computed<PublicConversationRow[]>(() =>
    this.items().map((item) => ({
      id: item.id,
      app: (item.app_type && APP_LABEL[item.app_type]) || 'App pública',
      visitor: item.is_customer ? 'Cliente con cuenta' : 'Visitante',
      messages: item.message_count,
      last: formatHistoryDate(item.last_message_at),
      created: formatHistoryDate(item.created_at),
    })),
  );

  readonly columns: TableColumn[] = [
    { key: 'created', label: 'Inicio', width: '170px' },
    { key: 'app', label: 'App', width: '170px', badge: true },
    { key: 'visitor', label: 'Quién', width: '160px' },
    { key: 'messages', label: 'Mensajes', width: '100px', align: 'right' },
    { key: 'last', label: 'Último mensaje', width: '170px', priority: 2 },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'created',
    subtitleKey: 'visitor',
    badgeKey: 'app',
    detailKeys: [
      { key: 'messages', label: 'Mensajes' },
      { key: 'last', label: 'Último mensaje' },
    ],
  };

  constructor() {
    void this.load();
  }

  date(value: string): string {
    return formatHistoryDate(value);
  }

  goTo(page: number): void {
    this.page.set(page);
    void this.load();
  }

  async open(row: PublicConversationRow): Promise<void> {
    try {
      this.selected.set(await firstValueFrom(this.api.publicConversation(row.id)));
    } catch (error) {
      this.error.set(
        parseApiError(error).userMessage ?? 'No se pudo abrir la conversación.',
      );
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await firstValueFrom(
        this.api.publicConversations(this.page(), this.limit),
      );
      this.items.set(result.items);
      this.total.set(result.total);
    } catch (error) {
      this.items.set([]);
      this.total.set(0);
      this.error.set(
        parseApiError(error).userMessage ??
          'No se pudo cargar el listado de conversaciones.',
      );
    } finally {
      this.loading.set(false);
    }
  }
}
