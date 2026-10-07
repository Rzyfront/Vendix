import {
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  input,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';

/** Minimal catalog shape the picker needs. `AIToolCatalogEntry` is assignable. */
export interface AiToolPickerEntry {
  name: string;
  domain: string;
  description?: string;
  readOnly?: boolean;
  clientSide?: boolean;
  requiresConfirmation?: boolean;
  irreversible?: boolean;
}

export type AiToolPickerMode = 'allow' | 'deny';

/**
 * How "all tools" is persisted in an allow list:
 * - `empty`: `[]` means no filter (agent `allowed_tools`).
 * - `wildcard`: `['*']` means all, `[]` means NONE (plan `tools_allowed`).
 */
export type AiToolPickerAllValue = 'empty' | 'wildcard';

type QuickFilter = 'all' | 'read' | 'write' | 'confirm' | 'client';

interface DomainGroup {
  domain: string;
  items: AiToolPickerEntry[];
  total: number;
  selectedTotal: number;
  selectedVisible: number;
  state: 'all' | 'some' | 'none';
}

const WILDCARD = '*';

@Component({
  selector: 'app-ai-tool-picker',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => AiToolPickerComponent),
      multi: true,
    },
  ],
  template: `
    <div class="space-y-2" [class.opacity-60]="disabledFromForm()">
      @if (label()) {
        <label class="block text-sm font-medium text-text-primary">{{ label() }}</label>
      }

      <!-- Estado / resumen -->
      <div class="rounded-lg border border-border bg-background p-3 space-y-2">
        @if (isAllMode()) {
          <p class="text-sm font-medium text-text-primary">
            Todas las herramientas ({{ catalog().length }})
            @if (allValue() === 'empty') {
              <span class="font-normal text-text-secondary">· sin filtro, incluye las futuras</span>
            } @else {
              <span class="font-normal text-text-secondary">· incluye las futuras</span>
            }
          </p>
        } @else if (isNoneMode()) {
          <p class="text-sm font-medium text-amber-600">Ninguna herramienta</p>
          <p class="flex items-start gap-1.5 text-xs text-amber-600">
            <app-icon name="alert-triangle" [size]="14" class="mt-0.5 shrink-0"></app-icon>
            <span>
              Con la lista vacía el agente del plan queda sin herramientas. Usa
              "Seleccionar todas" o marca las que correspondan.
            </span>
          </p>
        } @else {
          <p class="text-sm text-text-primary">
            <span class="font-medium">{{ selectedCatalog().length }}</span>
            {{ mode() === 'deny' ? 'denegadas' : 'seleccionadas' }} de {{ catalog().length }}
            <span class="text-text-secondary">
              · {{ readCount() }} lectura · {{ writeCount() }} escritura
              @if (clientCount() > 0) {
                · {{ clientCount() }} navegador
              }
            </span>
          </p>
          @if (selectedDomains().length > 0) {
            <div class="flex flex-wrap gap-1">
              @for (d of selectedDomains(); track d.domain) {
                <span
                  class="px-1.5 py-0.5 text-[11px] rounded border border-border bg-surface text-text-secondary"
                >
                  {{ d.domain }} {{ d.count }}
                </span>
              }
            </div>
          }
        }

        <!-- Acciones globales -->
        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="px-2.5 py-1.5 text-xs rounded-md border border-border bg-surface text-text-primary hover:bg-background disabled:opacity-50"
            [disabled]="disabledFromForm() || isAllMode()"
            (click)="selectAll()"
          >
            Seleccionar todas
          </button>
          <button
            type="button"
            class="px-2.5 py-1.5 text-xs rounded-md border border-border bg-surface text-text-primary hover:bg-background disabled:opacity-50"
            [disabled]="disabledFromForm() || isClearDisabled()"
            (click)="clear()"
          >
            {{ clearLabel() }}
          </button>
          @if (obsolete().length > 0) {
            <button
              type="button"
              class="px-2.5 py-1.5 text-xs rounded-md border border-amber-500/50 bg-surface text-amber-600 hover:bg-background disabled:opacity-50"
              [disabled]="disabledFromForm()"
              (click)="removeObsolete()"
            >
              Quitar obsoletas ({{ obsolete().length }})
            </button>
          }
        </div>
      </div>

      <!-- Buscador + filtros -->
      <div class="relative">
        <app-icon
          name="search"
          [size]="16"
          class="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none"
        ></app-icon>
        <input
          type="search"
          class="w-full rounded-lg border border-border bg-surface pl-8 pr-3 py-2 text-sm text-text-primary
                 placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          placeholder="Buscar por nombre, dominio o descripción"
          aria-label="Buscar herramientas"
          [value]="search()"
          [disabled]="disabledFromForm()"
          (input)="onSearch($event)"
        />
      </div>

      <div class="flex flex-wrap gap-1.5" role="group" aria-label="Filtros rápidos">
        @for (f of filterChips; track f.key) {
          <button
            type="button"
            class="px-2.5 py-1 text-xs rounded-full border transition-colors"
            [class.bg-primary]="filter() === f.key"
            [class.text-white]="filter() === f.key"
            [class.border-primary]="filter() === f.key"
            [class.bg-surface]="filter() !== f.key"
            [class.text-text-secondary]="filter() !== f.key"
            [class.border-border]="filter() !== f.key"
            [attr.aria-pressed]="filter() === f.key"
            (click)="filter.set(f.key)"
          >
            {{ f.label }}
          </button>
        }
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <span class="text-xs text-text-secondary">{{ filtered().length }} visibles</span>
        <button
          type="button"
          class="px-2 py-1 text-xs rounded-md border border-border bg-surface text-text-primary hover:bg-background disabled:opacity-50"
          [disabled]="disabledFromForm() || filtered().length === 0 || isAllMode()"
          (click)="selectVisible()"
        >
          {{ mode() === 'deny' ? 'Denegar visibles' : 'Seleccionar visibles' }}
        </button>
        <button
          type="button"
          class="px-2 py-1 text-xs rounded-md border border-border bg-surface text-text-primary hover:bg-background disabled:opacity-50"
          [disabled]="disabledFromForm() || filtered().length === 0"
          (click)="removeVisible()"
        >
          Quitar visibles
        </button>
      </div>

      <!-- Lista agrupada -->
      <div class="max-h-80 overflow-y-auto rounded-lg border border-border bg-surface divide-y divide-border">
        @for (g of groups(); track g.domain) {
          <section>
            <div class="flex items-center gap-2 px-3 py-2 bg-background">
              <input
                type="checkbox"
                class="rounded border-border text-primary focus:ring-primary"
                [checked]="g.state === 'all'"
                [indeterminate]="g.state === 'some'"
                [disabled]="disabledFromForm()"
                [attr.aria-label]="'Seleccionar dominio ' + g.domain"
                (change)="toggleDomain(g)"
              />
              <button
                type="button"
                class="flex flex-1 items-center gap-1.5 min-w-0 text-left"
                [attr.aria-expanded]="isExpanded(g.domain)"
                (click)="toggleExpand(g.domain)"
              >
                <app-icon
                  [name]="isExpanded(g.domain) ? 'chevron-down' : 'chevron-right'"
                  [size]="14"
                  class="shrink-0 text-text-secondary"
                ></app-icon>
                <span class="text-sm font-medium text-text-primary truncate">{{ g.domain }}</span>
              </button>
              <span class="text-xs text-text-secondary tabular-nums">
                {{ g.selectedTotal }}/{{ g.total }}
              </span>
            </div>

            @if (isExpanded(g.domain)) {
              <ul class="divide-y divide-border">
                @for (t of g.items; track t.name) {
                  <li>
                    <label class="flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-background">
                      <input
                        type="checkbox"
                        class="mt-0.5 rounded border-border text-primary focus:ring-primary"
                        [checked]="selectedSet().has(t.name)"
                        [disabled]="disabledFromForm()"
                        (change)="toggleTool(t.name)"
                      />
                      <span class="min-w-0 flex-1 space-y-0.5">
                        <span class="flex flex-wrap items-center gap-1">
                          <span class="font-mono text-xs text-text-primary break-all">{{ t.name }}</span>
                          @if (t.clientSide) {
                            <span class="badge-tool border-sky-500/40 text-sky-600">Navegador</span>
                          } @else if (t.readOnly) {
                            <span class="badge-tool border-emerald-500/40 text-emerald-600">Lectura</span>
                          } @else {
                            <span class="badge-tool border-amber-500/40 text-amber-600">Escritura</span>
                          }
                          @if (t.requiresConfirmation) {
                            <span class="badge-tool border-border text-text-secondary">Requiere confirmación</span>
                          }
                          @if (t.irreversible) {
                            <span class="badge-tool border-red-500/40 text-red-600">Irreversible</span>
                          }
                        </span>
                        @if (t.description) {
                          <span class="block text-xs text-text-secondary truncate" [title]="t.description">
                            {{ t.description }}
                          </span>
                        }
                      </span>
                    </label>
                  </li>
                }
              </ul>
            }
          </section>
        } @empty {
          <p class="px-3 py-4 text-sm text-text-secondary text-center">
            Ninguna herramienta coincide con la búsqueda o el filtro.
          </p>
        }

        @if (obsolete().length > 0) {
          <section>
            <div class="flex items-center gap-2 px-3 py-2 bg-background">
              <app-icon name="alert-triangle" [size]="14" class="text-amber-600"></app-icon>
              <span class="text-sm font-medium text-text-primary">Obsoletas</span>
              <span class="text-xs text-text-secondary">{{ obsolete().length }} ya no están en el catálogo</span>
            </div>
            <ul class="divide-y divide-border">
              @for (name of obsolete(); track name) {
                <li class="flex items-center gap-2 px-3 py-2">
                  <span class="font-mono text-xs text-text-primary break-all flex-1">{{ name }}</span>
                  <span class="badge-tool border-amber-500/40 text-amber-600">Obsoleta</span>
                  <button
                    type="button"
                    class="p-1 rounded text-text-secondary hover:text-text-primary disabled:opacity-50"
                    [disabled]="disabledFromForm()"
                    [attr.aria-label]="'Quitar ' + name"
                    (click)="removeOne(name)"
                  >
                    <app-icon name="x" [size]="14"></app-icon>
                  </button>
                </li>
              }
            </ul>
          </section>
        }
      </div>

      @if (helpText()) {
        <p class="text-xs text-text-secondary">{{ helpText() }}</p>
      }
      @if (errorText()) {
        <p class="text-xs text-red-600">{{ errorText() }}</p>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .badge-tool {
        display: inline-block;
        padding: 0 0.375rem;
        font-size: 10px;
        line-height: 1.1rem;
        border-width: 1px;
        border-style: solid;
        border-radius: 0.25rem;
        background: var(--color-surface, transparent);
      }
    `,
  ],
})
export class AiToolPickerComponent implements ControlValueAccessor {
  readonly tools = input<AiToolPickerEntry[]>([]);
  readonly mode = input<AiToolPickerMode>('allow');
  readonly allValue = input<AiToolPickerAllValue>('empty');
  readonly label = input<string>('');
  readonly helpText = input<string>('');
  readonly errorText = input<string>('');

  readonly value = signal<string[]>([]);
  readonly disabledFromForm = signal(false);
  readonly search = signal('');
  readonly filter = signal<QuickFilter>('all');
  private readonly expanded = signal<ReadonlySet<string>>(new Set());

  readonly filterChips: { key: QuickFilter; label: string }[] = [
    { key: 'all', label: 'Todas' },
    { key: 'read', label: 'Solo lectura' },
    { key: 'write', label: 'Escritura' },
    { key: 'confirm', label: 'Requieren confirmación' },
    { key: 'client', label: 'Navegador (ui_*)' },
  ];

  readonly catalog = computed(() => {
    const seen = new Set<string>();
    return this.tools().filter((t) => {
      if (seen.has(t.name)) return false;
      seen.add(t.name);
      return true;
    });
  });
  private readonly catalogNames = computed(
    () => new Set(this.catalog().map((t) => t.name)),
  );

  readonly isAllMode = computed(() => {
    if (this.mode() !== 'allow') return false;
    const v = this.value();
    return this.allValue() === 'empty' ? v.length === 0 : v.includes(WILDCARD);
  });
  readonly isNoneMode = computed(
    () =>
      this.mode() === 'allow' &&
      this.allValue() === 'wildcard' &&
      this.value().length === 0,
  );

  readonly selectedSet = computed<ReadonlySet<string>>(() =>
    this.isAllMode()
      ? this.catalogNames()
      : new Set(this.value().filter((n) => n !== WILDCARD)),
  );

  readonly obsolete = computed(() => {
    if (this.isAllMode()) return [];
    const names = this.catalogNames();
    return this.value().filter((n) => n !== WILDCARD && !names.has(n));
  });

  readonly selectedCatalog = computed(() =>
    this.catalog().filter((t) => this.selectedSet().has(t.name)),
  );
  readonly readCount = computed(
    () => this.selectedCatalog().filter((t) => this.isRead(t)).length,
  );
  readonly writeCount = computed(
    () => this.selectedCatalog().filter((t) => this.isWrite(t)).length,
  );
  readonly clientCount = computed(
    () => this.selectedCatalog().filter((t) => !!t.clientSide).length,
  );
  readonly selectedDomains = computed(() => {
    const counts = new Map<string, number>();
    for (const t of this.selectedCatalog()) {
      counts.set(t.domain, (counts.get(t.domain) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([domain, count]) => ({ domain, count }));
  });

  readonly searchActive = computed(() => this.search().trim().length > 0);

  readonly filtered = computed(() => {
    const tokens = this.normalize(this.search()).split(/\s+/).filter(Boolean);
    const f = this.filter();
    return this.catalog().filter((t) => {
      if (f === 'read' && !this.isRead(t)) return false;
      if (f === 'write' && !this.isWrite(t)) return false;
      if (f === 'confirm' && !t.requiresConfirmation) return false;
      if (f === 'client' && !t.clientSide) return false;
      if (tokens.length === 0) return true;
      const hay = this.normalize(`${t.name} ${t.domain} ${t.description ?? ''}`);
      return tokens.every((tok) => hay.includes(tok));
    });
  });

  readonly groups = computed<DomainGroup[]>(() => {
    const selected = this.selectedSet();
    const totals = new Map<string, { total: number; sel: number }>();
    for (const t of this.catalog()) {
      const e = totals.get(t.domain) ?? { total: 0, sel: 0 };
      e.total += 1;
      if (selected.has(t.name)) e.sel += 1;
      totals.set(t.domain, e);
    }
    const byDomain = new Map<string, AiToolPickerEntry[]>();
    for (const t of this.filtered()) {
      const list = byDomain.get(t.domain) ?? [];
      list.push(t);
      byDomain.set(t.domain, list);
    }
    return [...byDomain.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([domain, items]) => {
        const selectedVisible = items.filter((t) => selected.has(t.name)).length;
        const tot = totals.get(domain)!;
        return {
          domain,
          items,
          total: tot.total,
          selectedTotal: tot.sel,
          selectedVisible,
          state:
            selectedVisible === 0
              ? 'none'
              : selectedVisible === items.length
                ? 'all'
                : 'some',
        } as DomainGroup;
      });
  });

  readonly clearLabel = computed(() =>
    this.mode() === 'allow' && this.allValue() === 'empty'
      ? 'Restablecer (todas)'
      : 'Limpiar',
  );
  readonly isClearDisabled = computed(() => this.value().length === 0);

  private onChange: (value: string[]) => void = () => undefined;
  private onTouched: () => void = () => undefined;

  writeValue(value: string[] | null): void {
    this.value.set(Array.isArray(value) ? [...value] : []);
  }
  registerOnChange(fn: (value: string[]) => void): void {
    this.onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(disabled: boolean): void {
    this.disabledFromForm.set(disabled);
  }

  onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  isExpanded(domain: string): boolean {
    return this.searchActive() || this.expanded().has(domain);
  }

  toggleExpand(domain: string): void {
    this.expanded.update((s) => {
      const next = new Set(s);
      if (next.has(domain)) next.delete(domain);
      else next.add(domain);
      return next;
    });
  }

  toggleTool(name: string): void {
    const next = new Set(this.selectedSet());
    if (next.has(name)) next.delete(name);
    else next.add(name);
    this.commit(next);
  }

  toggleDomain(group: DomainGroup): void {
    const next = new Set(this.selectedSet());
    if (group.state === 'all') {
      group.items.forEach((t) => next.delete(t.name));
    } else {
      group.items.forEach((t) => next.add(t.name));
    }
    this.commit(next);
  }

  selectAll(): void {
    if (this.mode() === 'allow') {
      this.emit(this.allValue() === 'empty' ? [] : [WILDCARD]);
    } else {
      this.commit(new Set(this.catalog().map((t) => t.name)));
    }
  }

  clear(): void {
    this.emit([]);
  }

  selectVisible(): void {
    if (this.isAllMode()) return;
    const next = new Set(this.selectedSet());
    this.filtered().forEach((t) => next.add(t.name));
    this.commit(next);
  }

  removeVisible(): void {
    const next = new Set(this.selectedSet());
    this.filtered().forEach((t) => next.delete(t.name));
    this.commit(next);
  }

  removeObsolete(): void {
    const drop = new Set(this.obsolete());
    this.emit(this.value().filter((n) => !drop.has(n)));
  }

  removeOne(name: string): void {
    this.emit(this.value().filter((n) => n !== name));
  }

  /** Catalog order first, then obsolete names that stay selected. */
  private commit(set: ReadonlySet<string>): void {
    const names = this.catalogNames();
    const ordered = this.catalog()
      .map((t) => t.name)
      .filter((n) => set.has(n));
    const extra = [...set].filter((n) => n !== WILDCARD && !names.has(n));
    this.emit([...ordered, ...extra]);
  }

  private emit(next: string[]): void {
    this.value.set(next);
    this.onChange(next);
    this.onTouched();
  }

  private isRead(t: AiToolPickerEntry): boolean {
    return !!t.readOnly && !t.clientSide;
  }
  private isWrite(t: AiToolPickerEntry): boolean {
    return !t.readOnly && !t.clientSide;
  }

  private normalize(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  }
}
