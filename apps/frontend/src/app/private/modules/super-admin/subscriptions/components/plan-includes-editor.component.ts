import { Component, effect, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ButtonComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
} from '../../../../../shared/components';
import type { SelectorOption } from '../../../../../shared/components/selector/selector.component';
import {
  PlanIncludedItem,
  slugifyFeatureKey,
} from '../../../../../shared/utils/plan-features.util';

/** Estado visible del ítem. Se deriva de `enabled` + `is_limited`. */
type IncludeState = 'included' | 'limited' | 'excluded';

/**
 * Fila interna del editor. `uid` existe sólo para que `@for` pueda trackear una
 * fila mientras el usuario teclea la etiqueta (la `key` cambia con la etiqueta,
 * así que trackear por `key` destruiría el input en cada pulsación).
 */
interface IncludeRow {
  uid: string;
  key: string;
  label: string;
  state: IncludeState;
  value: string;
  /** true mientras la `key` siga derivando de la etiqueta (ítem nuevo o key auto). */
  autoKey: boolean;
  /** No editables: se conservan tal cual para datos legados. */
  limit: number | null;
  unit: string | null;
}

/** Tope del DTO backend (`@ArrayMaxSize(40)`). */
const MAX_ITEMS = 40;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** ¿La key actual se generó a partir de esta etiqueta (con o sin sufijo -2/-3)? */
function isDerivedKey(key: string, label: string): boolean {
  if (!key) return true;
  const base = slugifyFeatureKey(label);
  return key === base || new RegExp(`^${escapeRegExp(base)}-\\d+$`).test(key);
}

@Component({
  selector: 'app-plan-includes-editor',
  standalone: true,
  imports: [FormsModule, InputComponent, SelectorComponent, ButtonComponent, IconComponent],
  template: `
    <div class="space-y-4">
      <div class="rounded-lg border border-border bg-background p-3 space-y-1">
        <div class="flex items-center gap-2">
          <app-icon name="list-checks" [size]="16" class="text-primary"></app-icon>
          <h3 class="text-sm font-semibold text-text-primary">Ítems que incluye el plan</h3>
        </div>
        <p class="text-sm text-text-secondary">
          Esta lista es la que ve el visitante en la landing: aparece en la card del plan y en la
          tabla comparativa. Escribe las etiquetas <strong>idénticas entre planes</strong> (mismo
          texto, mismos acentos) para que la comparativa alinee las filas; una etiqueta distinta
          crea una fila nueva en lugar de compartir la existente. La lista se comparte entre todos
          los ciclos de facturación del plan.
        </p>
      </div>

      @if (legacy()) {
        <div
          class="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 flex items-start gap-2"
        >
          <app-icon name="alert-triangle" [size]="16" class="mt-0.5 shrink-0"></app-icon>
          <span>Formato antiguo: al guardar se convertirá en lista.</span>
        </div>
      }

      @if (rows().length > 0) {
        <div
          class="hidden md:grid md:grid-cols-12 gap-3 px-3 text-xs font-medium uppercase tracking-wide text-text-secondary"
        >
          <div class="md:col-span-5">Etiqueta</div>
          <div class="md:col-span-3">Estado</div>
          <div class="md:col-span-3">Valor (opcional)</div>
          <div class="md:col-span-1 text-right">Acciones</div>
        </div>
      }

      @for (row of rows(); track row.uid; let i = $index) {
        <div
          class="grid grid-cols-1 md:grid-cols-12 gap-3 p-3 bg-surface rounded-lg border border-border"
        >
          <div class="md:col-span-5">
            <app-input
              placeholder="Etiqueta (ej. Usuarios con roles)"
              size="sm"
              [required]="true"
              [maxlength]="120"
              [(ngModel)]="row.label"
              [ngModelOptions]="{ standalone: true }"
              (ngModelChange)="onLabelChange(i, $event)"
            ></app-input>
          </div>

          <div class="md:col-span-3">
            <app-selector
              size="sm"
              [options]="stateOptions"
              [(ngModel)]="row.state"
              [ngModelOptions]="{ standalone: true }"
              (ngModelChange)="onStateChange(i, $event)"
            ></app-selector>
          </div>

          <div class="md:col-span-3">
            <app-input
              placeholder="Ilimitados, 1 usuario, Límites de prueba"
              size="sm"
              [maxlength]="60"
              [(ngModel)]="row.value"
              [ngModelOptions]="{ standalone: true }"
              (ngModelChange)="onValueChange(i, $event)"
            ></app-input>
          </div>

          <div class="md:col-span-1 flex items-center justify-end gap-1">
            <button
              type="button"
              class="p-1.5 rounded-md hover:bg-gray-100 text-text-secondary disabled:opacity-40 disabled:hover:bg-transparent"
              [disabled]="i === 0"
              (click)="move(i, -1)"
              title="Subir"
              aria-label="Subir ítem"
            >
              <app-icon name="arrow-up" [size]="16"></app-icon>
            </button>
            <button
              type="button"
              class="p-1.5 rounded-md hover:bg-gray-100 text-text-secondary disabled:opacity-40 disabled:hover:bg-transparent"
              [disabled]="i === rows().length - 1"
              (click)="move(i, 1)"
              title="Bajar"
              aria-label="Bajar ítem"
            >
              <app-icon name="arrow-down" [size]="16"></app-icon>
            </button>
            <button
              type="button"
              class="p-1.5 rounded-md hover:bg-red-50 text-text-secondary hover:text-red-500"
              (click)="removeItem(i)"
              title="Eliminar"
              aria-label="Eliminar ítem"
            >
              <app-icon name="trash-2" [size]="16"></app-icon>
            </button>
          </div>
        </div>
      } @empty {
        <div
          class="rounded-lg border border-dashed border-border bg-background p-6 text-center space-y-2"
        >
          <app-icon name="list-checks" [size]="24" class="text-text-secondary"></app-icon>
          <p class="text-sm font-medium text-text-primary">Este plan aún no declara ítems</p>
          <p class="text-sm text-text-secondary">
            Agrega el primero: la card del plan en la landing quedará vacía hasta que exista al
            menos uno.
          </p>
        </div>
      }

      <div class="flex items-center gap-3">
        <app-button
          variant="outline"
          size="sm"
          [disabled]="rows().length >= maxItems"
          (clicked)="addItem()"
        >
          <app-icon name="plus" [size]="16" slot="icon"></app-icon>
          Agregar ítem
        </app-button>
        <span class="text-xs text-text-secondary">{{ rows().length }} / {{ maxItems }}</span>
      </div>
    </div>
  `,
})
export class PlanIncludesEditorComponent {
  readonly initialValue = input<PlanIncludedItem[] | undefined>(undefined);
  /** true cuando el plan venía con el `feature_matrix` legado en forma de objeto. */
  readonly legacy = input(false);
  readonly valueChange = output<PlanIncludedItem[]>();

  readonly rows = signal<IncludeRow[]>([]);
  readonly maxItems = MAX_ITEMS;

  readonly stateOptions: SelectorOption[] = [
    { value: 'included', label: 'Incluido' },
    { value: 'limited', label: 'Limitado' },
    { value: 'excluded', label: 'No incluido' },
  ];

  /**
   * Última forma serializada conocida. Se refresca también al emitir, de modo
   * que el eco del padre (`initialValue` = lo que acabamos de emitir) no vuelva
   * a hidratar las filas — eso regeneraría los `uid` en cada pulsación y el
   * input perdería el foco.
   */
  private lastSnapshot = '';

  constructor() {
    effect(() => {
      const incoming = this.initialValue();
      const snapshot = JSON.stringify(incoming ?? []);
      if (snapshot === this.lastSnapshot) return;
      this.lastSnapshot = snapshot;
      untracked(() => this.rows.set((incoming ?? []).map((item) => this.toRow(item))));
    });
  }

  addItem(): void {
    if (this.rows().length >= MAX_ITEMS) return;
    this.rows.update((list) => [
      ...list,
      {
        uid: crypto.randomUUID(),
        key: '',
        label: '',
        state: 'included' as IncludeState,
        value: '',
        autoKey: true,
        limit: null,
        unit: null,
      },
    ]);
    this.emitChange();
  }

  removeItem(index: number): void {
    this.rows.update((list) => list.filter((_, i) => i !== index));
    this.emitChange();
  }

  move(index: number, direction: -1 | 1): void {
    const target = index + direction;
    const list = [...this.rows()];
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    this.rows.set(list);
    this.emitChange();
  }

  onLabelChange(index: number, label: string): void {
    const next = String(label ?? '');
    this.rows.update((list) => {
      const copy = [...list];
      const row = { ...copy[index], label: next };
      if (row.autoKey) {
        const taken = copy.filter((_, i) => i !== index).map((r) => r.key);
        row.key = slugifyFeatureKey(next, taken);
      }
      copy[index] = row;
      return copy;
    });
    this.emitChange();
  }

  onStateChange(index: number, state: IncludeState): void {
    this.rows.update((list) => {
      const copy = [...list];
      copy[index] = { ...copy[index], state };
      return copy;
    });
    this.emitChange();
  }

  onValueChange(index: number, value: string): void {
    this.rows.update((list) => {
      const copy = [...list];
      copy[index] = { ...copy[index], value: String(value ?? '') };
      return copy;
    });
    this.emitChange();
  }

  private toRow(item: PlanIncludedItem): IncludeRow {
    const label = item.label ?? '';
    const key = item.key || slugifyFeatureKey(label);
    return {
      uid: crypto.randomUUID(),
      key,
      label,
      state: !item.enabled ? 'excluded' : item.is_limited ? 'limited' : 'included',
      value: item.value ?? '',
      autoKey: isDerivedKey(key, label),
      limit: typeof item.limit === 'number' ? item.limit : null,
      unit: item.unit ?? null,
    };
  }

  /**
   * `limit` y `unit` sólo viajan cuando traen dato real: el DTO backend los
   * declara opcionales y enviarlos en `null` puede tropezar con `@IsInt()`.
   */
  private toItem(row: IncludeRow): PlanIncludedItem {
    const label = row.label.trim();
    const item: PlanIncludedItem = {
      key: row.key || slugifyFeatureKey(label),
      label,
      enabled: row.state !== 'excluded',
      is_limited: row.state === 'limited',
    };
    const value = row.value.trim();
    if (value) item.value = value;
    if (typeof row.limit === 'number') item.limit = row.limit;
    if (row.unit) item.unit = row.unit;
    return item;
  }

  private emitChange(): void {
    const items = this.rows().map((row) => this.toItem(row));
    this.lastSnapshot = JSON.stringify(items);
    this.valueChange.emit(items);
  }
}
