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
  HistoryChangeEvent,
} from './agent-history.service';
import { HistoryAgentFilterComponent } from './history-agent-filter.component';
import { agentLabel, formatHistoryDate } from './history-format';

const KIND_LABEL: Record<HistoryChangeEvent['kind'], string> = {
  switch: 'Interruptor',
  agent_action: 'Acción del agente',
  conversation_purged: 'Conversación borrada',
  memory_edit: 'Memoria',
};

interface ChangeRow {
  id: string;
  when: string;
  agent: string;
  kind: string;
  summary: string;
  actor: string;
}

/** «Historial → Cambios»: read-only audit of the agents in this store. */
@Component({
  selector: 'app-agent-history-changes',
  standalone: true,
  imports: [
    ResponsiveDataViewComponent,
    PaginationComponent,
    HistoryAgentFilterComponent,
  ],
  template: `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
      <p class="text-sm text-[var(--color-text-secondary)]">
        Quién encendió o apagó cada agente, lo que aplicaron y las
        conversaciones borradas (sin su contenido).
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
      emptyIcon="history"
      emptyMessage="Todavía no hay cambios registrados"
      emptyTitle="Sin cambios"
      emptyDescription="Aquí aparecerán los cambios de los agentes de tu tienda."
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
export class AgentHistoryChangesComponent {
  private readonly api = inject(AgentHistoryApiService);

  readonly limit = 20;
  readonly agent = signal<HistoryAgentFilter>('all');
  readonly page = signal(1);
  readonly total = signal(0);
  readonly items = signal<HistoryChangeEvent[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly totalPages = computed(() => Math.ceil(this.total() / this.limit));

  readonly rows = computed<ChangeRow[]>(() =>
    this.items().map((event) => ({
      id: event.id,
      when: formatHistoryDate(event.created_at),
      agent: agentLabel(event.agent_key),
      kind: KIND_LABEL[event.kind] ?? event.kind,
      summary: event.summary,
      actor: event.actor?.name || 'Sistema',
    })),
  );

  readonly columns: TableColumn[] = [
    { key: 'when', label: 'Fecha', width: '170px' },
    { key: 'agent', label: 'Agente', width: '90px', badge: true },
    { key: 'kind', label: 'Tipo', width: '170px' },
    { key: 'summary', label: 'Detalle' },
    { key: 'actor', label: 'Quién', width: '160px', priority: 2 },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'summary',
    subtitleKey: 'when',
    badgeKey: 'agent',
    detailKeys: [
      { key: 'kind', label: 'Tipo' },
      { key: 'actor', label: 'Quién' },
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
        this.api.changes(this.page(), this.limit, this.agent()),
      );
      this.items.set(result.items);
      this.total.set(result.total);
    } catch (error) {
      this.items.set([]);
      this.total.set(0);
      this.error.set(
        parseApiError(error).userMessage ??
          'No se pudo cargar el historial de cambios.',
      );
    } finally {
      this.loading.set(false);
    }
  }
}
