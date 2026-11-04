import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDragPlaceholder, CdkDropList } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { addBlockBlocker, blockDef, blockSummary, catalogForMode, countedBlocks, isFixedBlock } from './builder-blocks';
import type { BuilderBlock, BuilderCatalog, BuilderOperationMode } from './builder.types';

/**
 * F6-A — the page outline of the builder (engine, app-agnostic): the sections
 * in page order with every per-section action in one row (drag, move,
 * duplicate, hide, delete), and the catalog to add one, filtered by the
 * page's operation mode. It owns no data: it emits intents and the editor
 * applies them with the pure operations of `builder-blocks.ts`.
 */
@Component({
  selector: 'app-builder-outline',
  standalone: true,
  imports: [CdkDropList, CdkDrag, CdkDragHandle, CdkDragPlaceholder, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-full min-h-0 flex-col" data-testid="builder-outline">
      @if (!adding()) {
        <div class="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
          <div>
            <h2 class="text-sm font-semibold text-[var(--color-text-primary)]">Secciones</h2>
            <p class="text-[11px] text-[var(--color-text-secondary)]">{{ count() }} de {{ catalog().maxBlocks }} · arrastra para ordenar</p>
          </div>
          <button type="button" data-testid="builder-add"
                  class="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-primary)] px-2.5 py-1.5 text-xs font-semibold text-[var(--color-text-on-primary,#fff)] disabled:opacity-50"
                  [disabled]="full()" [attr.title]="full() ? 'Llegaste al máximo de secciones' : null"
                  (click)="adding.set(true)">
            <app-icon name="plus" [size]="14" /> Agregar
          </button>
        </div>

        @if (blocks().length === 0) {
          <div class="m-3 rounded-xl border border-dashed border-[var(--color-border)] p-5 text-center" data-testid="builder-empty">
            <app-icon name="layout-list" [size]="22" class="text-[var(--color-text-secondary)]" />
            <p class="mt-2 text-sm font-medium text-[var(--color-text-primary)]">Tu página no tiene secciones</p>
            <p class="mt-1 text-xs text-[var(--color-text-secondary)]">Empieza por una portada y un formulario de contacto.</p>
            <button type="button" class="mt-3 text-xs font-semibold text-[var(--color-primary)]" (click)="adding.set(true)">
              Agregar la primera sección
            </button>
          </div>
        } @else {
          <ol cdkDropList class="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3" (cdkDropListDropped)="onDrop($event)"
              aria-label="Secciones de la página">
            @for (block of blocks(); track block.id; let i = $index; let first = $first; let last = $last) {
              <li cdkDrag [cdkDragData]="block.id" [cdkDragDisabled]="fixed(block)" [attr.data-block-id]="block.id"
                  class="group rounded-lg border bg-[var(--color-surface)] transition-colors"
                  [class.border-[var(--color-primary)]]="selectedId() === block.id"
                  [class.ring-1]="selectedId() === block.id"
                  [class.ring-[var(--color-primary)]]="selectedId() === block.id"
                  [class.border-[var(--color-border)]]="selectedId() !== block.id">
                <div *cdkDragPlaceholder class="h-12 rounded-lg border-2 border-dashed border-[var(--color-primary)] opacity-60"></div>
                <div class="flex items-center gap-1.5 py-1.5 pl-1 pr-1.5">
                  @if (fixed(block)) {
                    <span class="rounded p-1 text-[var(--color-text-secondary)]" [attr.title]="fixedHint(block)" data-testid="builder-fixed">
                      <app-icon name="pin" [size]="14" />
                    </span>
                  } @else {
                    <button type="button" cdkDragHandle class="cursor-grab rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-background)] active:cursor-grabbing"
                            [attr.aria-label]="'Arrastrar ' + label(block)">
                      <app-icon name="grip-vertical" [size]="14" />
                    </button>
                  }
                  <button type="button" class="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left"
                          [class.opacity-50]="block.hidden" (click)="select.emit(block.id)"
                          [attr.aria-pressed]="selectedId() === block.id" data-testid="builder-select">
                    <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[var(--color-background)] text-[var(--color-primary)]">
                      <app-icon [name]="icon(block)" [size]="14" />
                    </span>
                    <span class="min-w-0">
                      <span class="block truncate text-[13px] font-medium text-[var(--color-text-primary)]">{{ label(block) }}</span>
                      <span class="block truncate text-[11px] text-[var(--color-text-secondary)]">
                        {{ block.hidden ? 'Oculta · no se publica' : (summary(block) || 'Sin texto propio') }}
                      </span>
                    </span>
                  </button>

                  @if (confirmingDelete() === block.id) {
                    <div class="flex shrink-0 items-center gap-1" data-testid="builder-confirm-delete">
                      <button type="button" class="rounded-md bg-[var(--color-error,#dc2626)] px-2 py-1 text-[11px] font-semibold text-white"
                              (click)="confirmRemove(block.id)">Eliminar</button>
                      <button type="button" class="rounded-md px-2 py-1 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-background)]"
                              (click)="confirmingDelete.set(null)">No</button>
                    </div>
                  } @else {
                    <div class="flex shrink-0 items-center opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100"
                         [class.md:opacity-100]="selectedId() === block.id">
                      @if (!fixed(block)) {
                        <button type="button" class="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-background)] disabled:opacity-30"
                                [disabled]="first || fixedAt(i - 1)" (click)="move.emit({ from: i, to: i - 1 })" aria-label="Subir sección" title="Subir (Alt+↑)">
                          <app-icon name="chevron-up" [size]="14" />
                        </button>
                        <button type="button" class="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-background)] disabled:opacity-30"
                                [disabled]="last || fixedAt(i + 1)" (click)="move.emit({ from: i, to: i + 1 })" aria-label="Bajar sección" title="Bajar (Alt+↓)">
                          <app-icon name="chevron-down" [size]="14" />
                        </button>
                      }
                      @if (!virtual(block)) {
                        <button type="button" class="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-background)] disabled:opacity-30"
                                [disabled]="!!duplicateBlocker(block)" [attr.title]="duplicateBlocker(block) ?? 'Duplicar'"
                                (click)="duplicate.emit(block.id)" aria-label="Duplicar sección" data-testid="builder-duplicate">
                          <app-icon name="copy" [size]="14" />
                        </button>
                        <button type="button" class="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-background)]"
                                (click)="toggleHidden.emit(block.id)" [attr.aria-label]="block.hidden ? 'Mostrar sección' : 'Ocultar sección'"
                                [attr.title]="block.hidden ? 'Mostrar' : 'Ocultar'" data-testid="builder-toggle-hidden">
                          <app-icon [name]="block.hidden ? 'eye' : 'eye-off'" [size]="14" />
                        </button>
                      }
                      @if (removable(block)) {
                        <button type="button" class="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-background)] hover:text-[var(--color-error,#dc2626)]"
                                (click)="confirmingDelete.set(block.id)" aria-label="Eliminar sección" title="Eliminar" data-testid="builder-remove">
                          <app-icon name="trash-2" [size]="14" />
                        </button>
                      }
                    </div>
                  }
                </div>
              </li>
            }
          </ol>
        }
      } @else {
        <!-- Catálogo -->
        <div class="flex items-center justify-between gap-2 px-3 pb-2 pt-3">
          <h2 class="text-sm font-semibold text-[var(--color-text-primary)]">Agregar sección</h2>
          <button type="button" class="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-background)]"
                  (click)="closeCatalog()" aria-label="Cerrar catálogo">
            <app-icon name="x" [size]="16" />
          </button>
        </div>
        <div class="px-3 pb-2">
          <label class="relative block">
            <app-icon name="search" [size]="14" class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]" />
            <input type="search" placeholder="Buscar sección" data-testid="builder-catalog-search"
                   class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-1.5 pl-8 pr-2 text-sm"
                   [value]="query()" (input)="query.set($any($event.target).value)" />
          </label>
          <div class="mt-2 flex flex-wrap gap-1">
            @for (c of categoryChips(); track c.id) {
              <button type="button" class="rounded-full border px-2.5 py-0.5 text-[11px] font-medium"
                      [class]="category() === c.id
                        ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-[var(--color-text-on-primary,#fff)]'
                        : 'border-[var(--color-border)] text-[var(--color-text-secondary)]'"
                      (click)="category.set(c.id)">{{ c.label }}</button>
            }
          </div>
        </div>
        <ul class="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3" data-testid="builder-catalog">
          @for (def of visibleCatalog(); track def.type) {
            <li>
              <button type="button" class="flex w-full items-start gap-2.5 rounded-lg border border-transparent p-2 text-left hover:border-[var(--color-border)] hover:bg-[var(--color-background)] disabled:cursor-not-allowed disabled:opacity-50"
                      [disabled]="!!blocker(def.type)" [attr.data-type]="def.type" (click)="pick(def.type)">
                <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--color-background)] text-[var(--color-primary)]">
                  <app-icon [name]="def.icon" [size]="16" />
                </span>
                <span class="min-w-0">
                  <span class="block text-[13px] font-medium text-[var(--color-text-primary)]">{{ def.label }}</span>
                  <span class="block text-[11px] leading-snug text-[var(--color-text-secondary)]">{{ blocker(def.type) ?? def.description }}</span>
                </span>
              </button>
            </li>
          } @empty {
            <li class="px-2 py-6 text-center text-xs text-[var(--color-text-secondary)]">Ninguna sección coincide con «{{ query() }}».</li>
          }
        </ul>
      }
    </div>
  `,
})
export class BuilderOutlineComponent {
  readonly catalog = input.required<BuilderCatalog>();
  readonly mode = input.required<BuilderOperationMode>();
  readonly blocks = input.required<readonly BuilderBlock[]>();
  readonly selectedId = input<string | null>(null);

  readonly select = output<string>();
  readonly add = output<string>();
  readonly move = output<{ from: number; to: number }>();
  readonly duplicate = output<string>();
  readonly toggleHidden = output<string>();
  readonly remove = output<string>();

  readonly adding = signal(false);
  readonly query = signal('');
  readonly category = signal('all');
  readonly confirmingDelete = signal<string | null>(null);

  /** Sections that count toward the limit (a virtual cover does not). */
  readonly count = computed(() => countedBlocks(this.catalog(), this.blocks()));
  readonly full = computed(() => this.count() >= this.catalog().maxBlocks);
  readonly categoryChips = computed(() => [{ id: 'all', label: 'Todas' }, ...this.catalog().categories]);
  readonly visibleCatalog = computed(() => {
    const term = this.query().trim().toLowerCase();
    const category = this.category();
    return catalogForMode(this.catalog(), this.mode()).filter(
      (def) =>
        (category === 'all' || def.category === category) &&
        (!term || `${def.label} ${def.description}`.toLowerCase().includes(term)),
    );
  });

  label(block: BuilderBlock): string {
    return blockDef(this.catalog(), block.type)?.label ?? block.type;
  }

  icon(block: BuilderBlock): string {
    return blockDef(this.catalog(), block.type)?.icon ?? 'layers';
  }

  /** F6-B: virtual and pinned blocks keep their place: no drag, no arrows. */
  fixed(block: BuilderBlock): boolean {
    return isFixedBlock(this.catalog(), block);
  }

  fixedAt(index: number): boolean {
    const block = this.blocks()[index];
    return !!block && this.fixed(block);
  }

  virtual(block: BuilderBlock): boolean {
    return !!blockDef(this.catalog(), block.type)?.virtual;
  }

  removable(block: BuilderBlock): boolean {
    const def = blockDef(this.catalog(), block.type);
    return !def?.virtual && def?.removable !== false;
  }

  fixedHint(block: BuilderBlock): string {
    const def = blockDef(this.catalog(), block.type);
    if (def?.virtual) return 'Siempre va arriba';
    return def?.pinned === 'end' ? 'La página la muestra al final' : 'La página la muestra en este lugar';
  }

  summary(block: BuilderBlock): string {
    return blockSummary(block);
  }

  blocker(type: string): string | null {
    return addBlockBlocker(this.catalog(), this.blocks(), type);
  }

  duplicateBlocker(block: BuilderBlock): string | null {
    return this.blocker(block.type);
  }

  pick(type: string): void {
    if (this.blocker(type)) return;
    this.add.emit(type);
    this.closeCatalog();
  }

  closeCatalog(): void {
    this.adding.set(false);
    this.query.set('');
    this.category.set('all');
  }

  confirmRemove(id: string): void {
    this.confirmingDelete.set(null);
    this.remove.emit(id);
  }

  onDrop(event: CdkDragDrop<unknown>): void {
    if (event.previousIndex !== event.currentIndex) {
      this.move.emit({ from: event.previousIndex, to: event.currentIndex });
    }
  }
}
