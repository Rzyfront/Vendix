import { Component, effect, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AIFeatureConfig,
  AIFeatureFlags,
  AIFeatureKey,
} from '../interfaces/subscription-admin.interface';
import {
  ToggleComponent,
  InputComponent,
  MultiSelectorComponent,
  SelectorComponent,
} from '../../../../../shared/components';

interface FeatureDefinition {
  key: AIFeatureKey;
  label: string;
  description: string;
  capField?: keyof AIFeatureConfig;
  capLabel?: string;
  capHelp?: string;
}

@Component({
  selector: 'app-ai-feature-matrix',
  standalone: true,
  imports: [FormsModule, ToggleComponent, InputComponent, MultiSelectorComponent, SelectorComponent],
  template: `
    <div class="space-y-5">
      <div class="rounded-lg border border-border bg-background p-4 space-y-2">
        <h2 class="text-sm font-semibold text-text-primary uppercase tracking-wide">
          Funciones IA del plan
        </h2>
        <p class="text-sm text-text-secondary">
          Estos switches alimentan el subscription gate del backend. Los modelos no se eligen aqui:
          se toman de las aplicaciones y configuraciones activas del IA Engine para evitar listas
          hardcodeadas que despues no se usan en ejecucion.
        </p>
        <div class="flex flex-wrap gap-2 pt-1">
          @for (model of systemModels(); track model) {
            <span class="px-2 py-1 text-xs rounded-md border border-border bg-surface text-text-secondary">
              {{ model }}
            </span>
          }
          @if (systemModels().length === 0) {
            <span class="text-xs text-text-secondary">
              No hay modelos activos cargados desde IA Engine.
            </span>
          }
        </div>
      </div>

      <div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
        @for (feature of features; track feature.key) {
          <div class="p-4 bg-surface rounded-lg border border-border space-y-4">
            <div class="flex items-start justify-between gap-4">
              <div class="space-y-1">
                <h3 class="text-sm font-semibold text-text-primary">{{ feature.label }}</h3>
                <p class="text-sm text-text-secondary">{{ feature.description }}</p>
              </div>
              <app-toggle
                [ngModel]="config(feature.key).enabled"
                (ngModelChange)="updateFeature(feature.key, { enabled: $event })"
                [ariaLabel]="feature.label"
              ></app-toggle>
            </div>

            @if (feature.capField) {
              <app-input
                [label]="feature.capLabel ?? ''"
                type="number"
                [min]="0"
                [ngModel]="capValue(feature)"
                (ngModelChange)="updateCap(feature, $event)"
                [helperText]="feature.capHelp ?? ''"
              ></app-input>
            }

            @if (feature.key === 'tool_agents') {
              <app-multi-selector
                label="Herramientas permitidas"
                [options]="toolOptions"
                [ngModel]="config('tool_agents').tools_allowed ?? []"
                (ngModelChange)="updateFeature('tool_agents', { tools_allowed: toStringArray($event) })"
                placeholder="Seleccionar herramientas"
                helpText="Si el feature esta apagado, estas herramientas no se habilitan aunque esten listadas."
              ></app-multi-selector>
            }

            <app-selector
              label="Comportamiento en gracia dura"
              [options]="degradationOptions"
              [ngModel]="config(feature.key).degradation ?? 'block'"
              (ngModelChange)="updateDegradation(feature.key, $event)"
              helpText="Define si el modulo se mantiene, avisa o se bloquea durante estados de cobro criticos."
            ></app-selector>
          </div>
        }
      </div>
    </div>
  `,
})
export class AiFeatureMatrixComponent {
  readonly initialValue = input<AIFeatureFlags | undefined>(undefined);
  readonly systemModels = input<string[]>([]);
  readonly valueChange = output<AIFeatureFlags>();

  private lastInitialSnapshot = '';
  readonly flags = signal<AIFeatureFlags>(this.defaultFlags());

  readonly features: FeatureDefinition[] = [
    {
      key: 'text_generation',
      label: 'Generacion de texto',
      description: 'Habilita llamadas del IA Engine que consumen tokens para redactar, resumir o transformar contenido.',
      capField: 'monthly_tokens_cap',
      capLabel: 'Tokens mensuales',
      capHelp: 'Cupo mensual consumido por AIEngineService.run(). Cero significa sin cupo util.',
    },
    {
      key: 'streaming_chat',
      label: 'Chat en streaming',
      description: 'Permite respuestas progresivas en el chat IA de tienda y experiencias conversacionales en vivo.',
      capField: 'daily_messages_cap',
      capLabel: 'Mensajes diarios',
      capHelp: 'Cupo diario de mensajes de chat por tienda.',
    },
    {
      key: 'conversations',
      label: 'Conversaciones',
      description: 'Permite conservar historial conversacional para contexto, auditoria y continuidad de sesiones.',
      capField: 'retention_days',
      capLabel: 'Retencion en dias',
      capHelp: 'Dias de historial disponible para este plan.',
    },
    {
      key: 'tool_agents',
      label: 'Agentes con herramientas',
      description: 'Autoriza agentes IA a ejecutar herramientas internas permitidas por el plan.',
    },
    {
      key: 'rag_embeddings',
      label: 'RAG y embeddings',
      description: 'Habilita indexacion y busqueda semantica sobre documentos o datos conectados.',
      capField: 'indexed_docs_cap',
      capLabel: 'Documentos indexados',
      capHelp: 'Cantidad maxima de documentos indexados para busqueda semantica.',
    },
    {
      key: 'async_queue',
      label: 'Jobs IA asincronos',
      description: 'Permite tareas IA en cola para procesos largos como analisis, clasificacion o generacion masiva.',
      capField: 'monthly_jobs_cap',
      capLabel: 'Jobs mensuales',
      capHelp: 'Cupo mensual de jobs asincronos IA.',
    },
  ];

  readonly degradationOptions = [
    { value: 'block', label: 'Bloquear' },
    { value: 'warn', label: 'Permitir con aviso' },
  ];

  readonly toolOptions = [
    { value: 'products.search', label: 'Productos', description: 'Busqueda y lectura de catalogo' },
    { value: 'inventory.read', label: 'Inventario', description: 'Consulta de existencias y movimientos' },
    { value: 'orders.read', label: 'Ordenes', description: 'Consulta de pedidos y estados' },
    { value: 'customers.read', label: 'Clientes', description: 'Consulta de perfiles y actividad' },
    { value: 'accounting.read', label: 'Contabilidad', description: 'Lectura de resumenes contables' },
  ];

  constructor() {
    effect(() => {
      const initial = this.initialValue();
      const snapshot = JSON.stringify(initial ?? {});
      if (snapshot === this.lastInitialSnapshot) return;
      this.lastInitialSnapshot = snapshot;
      this.flags.set(this.normalizeFlags(initial));
    });
  }

  config(key: AIFeatureKey): AIFeatureConfig {
    return this.flags()[key] ?? this.defaultFlags()[key]!;
  }

  updateFeature(key: AIFeatureKey, patch: Partial<AIFeatureConfig>): void {
    this.flags.update((flags) => ({
      ...flags,
      [key]: {
        ...this.config(key),
        ...patch,
      },
    }));
    this.emitChange();
  }

  updateCap(feature: FeatureDefinition, value: unknown): void {
    if (!feature.capField) return;
    this.updateFeature(feature.key, {
      [feature.capField]: this.toNullableNumber(value),
    } as Partial<AIFeatureConfig>);
  }

  capValue(feature: FeatureDefinition): any {
    return feature.capField ? this.config(feature.key)[feature.capField] : null;
  }

  updateDegradation(key: AIFeatureKey, value: string | number | null): void {
    const degradation = value === 'warn' ? value : 'block';
    this.updateFeature(key, { degradation });
  }

  toNullableNumber(value: unknown): number | null {
    if (value === '' || value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  toStringArray(value: (string | number)[]): string[] {
    return value.map((item) => String(item));
  }

  private emitChange(): void {
    this.valueChange.emit({ ...this.flags() });
  }

  private normalizeFlags(value: AIFeatureFlags | undefined): AIFeatureFlags {
    const defaults = this.defaultFlags();
    const raw = (value ?? {}) as Record<string, any>;

    if (
      raw['text_generation'] ||
      raw['streaming_chat'] ||
      raw['conversations'] ||
      raw['tool_agents'] ||
      raw['rag_embeddings'] ||
      raw['async_queue']
    ) {
      return {
        text_generation: { ...defaults.text_generation, ...raw['text_generation'] },
        streaming_chat: { ...defaults.streaming_chat, ...raw['streaming_chat'] },
        conversations: { ...defaults.conversations, ...raw['conversations'] },
        tool_agents: { ...defaults.tool_agents, ...raw['tool_agents'] },
        rag_embeddings: { ...defaults.rag_embeddings, ...raw['rag_embeddings'] },
        async_queue: { ...defaults.async_queue, ...raw['async_queue'] },
      };
    }

    return {
      ...defaults,
      text_generation: {
        ...defaults.text_generation,
        enabled: raw['chat_enabled'] ?? defaults.text_generation!.enabled,
        monthly_tokens_cap: raw['max_tokens_per_month'] ?? defaults.text_generation!.monthly_tokens_cap,
      },
      streaming_chat: {
        ...defaults.streaming_chat,
        enabled: raw['streaming_enabled'] ?? defaults.streaming_chat!.enabled,
        daily_messages_cap: raw['max_conversations'] ?? defaults.streaming_chat!.daily_messages_cap,
      },
      conversations: {
        ...defaults.conversations,
        enabled: raw['chat_enabled'] ?? defaults.conversations!.enabled,
      },
      tool_agents: {
        ...defaults.tool_agents,
        enabled: raw['agent_enabled'] ?? raw['custom_tools_enabled'] ?? defaults.tool_agents!.enabled,
      },
      rag_embeddings: {
        ...defaults.rag_embeddings,
        enabled: raw['rag_enabled'] ?? raw['embeddings_enabled'] ?? defaults.rag_embeddings!.enabled,
      },
    };
  }

  private defaultFlags(): Required<AIFeatureFlags> {
    return {
      text_generation: {
        enabled: true,
        monthly_tokens_cap: 100000,
        degradation: 'block',
        period: 'monthly',
      },
      streaming_chat: {
        enabled: true,
        daily_messages_cap: 100,
        degradation: 'warn',
        period: 'daily',
      },
      conversations: {
        enabled: true,
        retention_days: 90,
        degradation: 'warn',
      },
      tool_agents: {
        enabled: false,
        tools_allowed: [],
        degradation: 'block',
      },
      rag_embeddings: {
        enabled: true,
        indexed_docs_cap: 1000,
        degradation: 'block',
        period: 'monthly',
      },
      async_queue: {
        enabled: false,
        monthly_jobs_cap: 500,
        degradation: 'block',
        period: 'monthly',
      },
    };
  }
}
