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
  HistoryAgentFilter,
  HistoryConversation,
} from './agent-history.service';
import { HistoryAgentFilterComponent } from './history-agent-filter.component';
import { agentLabel, formatHistoryDate } from './history-format';

interface ConversationRow {
  id: number;
  agent: string;
  user: string;
  title: string;
  messages: number;
  updated: string;
  created: string;
}

/**
 * «Historial → Conversaciones»: every conversation of the store (who, when,
 * title). Listing only: the content of other people's conversations is never
 * requested here.
 */
@Component({
  selector: 'app-agent-history-conversations',
  standalone: true,
  imports: [
    ResponsiveDataViewComponent,
    PaginationComponent,
    HistoryAgentFilterComponent,
  ],
  template: `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <p class="text-sm text-[var(--color-text-secondary)]">
        Las conversaciones de tu tienda con cada agente: quién, cuándo y de qué
        trataron. Solo lectura.
      </p>
      <app-history-agent-filter [value]="agent()" (changed)="setAgent($event)" />
    </div>

    @if (error()) {
      <p class="text-sm text-[var(--color-error)]" role="alert">{{ error() }}</p>
    }

    <app-responsive-data-view
      [data]="rows()"
      [columns]="columns"
      [cardConfig]="cardConfig"
      [loading]="loading()"
      emptyIcon="message-square"
      emptyMessage="Todavía no hay conversaciones"
      emptyTitle="Sin conversaciones"
      emptyDescription="Aquí aparecerán las conversaciones de tu tienda con Vex y Vexi."
    />

    <div class="mt-4">
      <app-pagination
        [currentPage]="page()"
        [totalPages]="totalPages()"
        [total]="total()"
        [limit]="limit"
        infoStyle="default"
        (pageChange)="goTo($event)"
      />
    </div>
  `,
  styles: [':host { display: block; width: 100%; }'],
})
export class AgentHistoryConversationsComponent {
  private readonly api = inject(AgentHistoryApiService);

  readonly limit = 20;
  readonly agent = signal<HistoryAgentFilter>('all');
  readonly page = signal(1);
  readonly total = signal(0);
  readonly items = signal<HistoryConversation[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly totalPages = computed(() => Math.ceil(this.total() / this.limit));

  readonly rows = computed<ConversationRow[]>(() =>
    this.items().map((item) => ({
      id: item.id,
      agent: agentLabel(item.agent_key),
      user: item.user
        ? item.is_own
          ? `${item.user.name} (tú)`
          : item.user.name
        : 'Usuario eliminado',
      title: item.title?.trim() || 'Sin título',
      messages: item.message_count,
      updated: formatHistoryDate(item.updated_at),
      created: formatHistoryDate(item.created_at),
    })),
  );

  readonly columns: TableColumn[] = [
    { key: 'title', label: 'Título' },
    { key: 'agent', label: 'Agente', width: '90px', badge: true },
    { key: 'user', label: 'Quién', width: '180px' },
    { key: 'messages', label: 'Mensajes', width: '100px', align: 'right' },
    { key: 'updated', label: 'Última actividad', width: '170px', priority: 2 },
    { key: 'created', label: 'Creada', width: '170px', priority: 3 },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'title',
    subtitleKey: 'user',
    badgeKey: 'agent',
    detailKeys: [
      { key: 'messages', label: 'Mensajes' },
      { key: 'updated', label: 'Última actividad' },
    ],
  };

  constructor() {
    void this.load();
  }

  setAgent(agent: HistoryAgentFilter): void {
    if (agent === this.agent()) return;
    this.agent.set(agent);
    this.page.set(1);
    void this.load();
  }

  goTo(page: number): void {
    this.page.set(page);
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await firstValueFrom(
        this.api.conversations(this.page(), this.limit, this.agent()),
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
