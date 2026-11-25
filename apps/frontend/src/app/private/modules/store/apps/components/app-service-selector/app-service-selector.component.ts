import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

import { IconComponent, ModalComponent, SpinnerComponent } from '../../../../../../shared/components';
import { CurrencyFormatService, CurrencyPipe } from '../../../../../../shared/pipes/currency';
import { formatDuration } from '../../../../../../public/service-page/service-page.util';
import type { ServicePageContext } from '../../page-builder/service-page/service-page-builder';
import { StoreAppsService } from '../../services/store-apps.service';
import { MAX_BLOCK_SERVICE_IDS } from '../../templates/app-page.types';

/** Un servicio en línea de la tienda, tal como lo pinta la página (precio final incluido). */
export type SelectableService = ServicePageContext['services'][number];

/** Texto sin tildes ni mayúsculas, para buscar «depilacion» y encontrar «Depilación». */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Selector de servicios para el bloque `services` de Service Page.
 *
 * Lista los servicios que la página puede mostrar (los «en línea» de la tienda,
 * leídos de `GET /store/apps/service_page/preview-context`, el mismo dato que
 * pinta la vista previa), así que precio y duración son los de la página.
 * Chips removibles y reordenables en el inspector y un modal accesible
 * (`app-modal`) con búsqueda por nombre, miniatura, duración y precio,
 * multiselección en orden y tope de 50.
 */
@Component({
  selector: 'app-service-selector',
  standalone: true,
  imports: [IconComponent, ModalComponent, SpinnerComponent, CurrencyPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-2.5" data-testid="app-service-selector">
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs font-semibold text-[var(--color-text-primary)]">{{ label() }}</span>
        <span class="text-[11px] text-[var(--color-text-secondary)]" data-testid="service-selector-count">
          {{ selectedIds().length }} / {{ max() }}
        </span>
      </div>

      @if (chips().length > 0) {
        <ul class="space-y-1.5" role="list" [attr.aria-label]="label()" data-testid="service-selector-chips">
          @for (chip of chips(); track chip.id; let i = $index; let first = $first; let last = $last) {
            <li
              class="flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs"
              [attr.data-testid]="'service-selector-chip-' + chip.id"
            >
              <span class="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded bg-[var(--color-background)] text-[var(--color-text-secondary)]">
                @if (chip.image_url) {
                  <img [src]="chip.image_url" alt="" class="h-full w-full object-cover" loading="lazy" />
                } @else {
                  <app-icon name="calendar" [size]="14" />
                }
              </span>
              <span class="min-w-0 flex-1 truncate font-medium text-[var(--color-text-primary)]">{{ chip.name }}</span>
              <div class="flex shrink-0 items-center gap-0.5">
                <button
                  type="button"
                  class="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-background)] disabled:opacity-30"
                  [disabled]="first"
                  [attr.aria-label]="'Subir ' + chip.name"
                  [attr.data-testid]="'service-selector-up-' + chip.id"
                  (click)="moveChip(i, i - 1)"
                >
                  <app-icon name="chevron-up" [size]="12" />
                </button>
                <button
                  type="button"
                  class="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-background)] disabled:opacity-30"
                  [disabled]="last"
                  [attr.aria-label]="'Bajar ' + chip.name"
                  [attr.data-testid]="'service-selector-down-' + chip.id"
                  (click)="moveChip(i, i + 1)"
                >
                  <app-icon name="chevron-down" [size]="12" />
                </button>
                <button
                  type="button"
                  class="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-background)] hover:text-[var(--color-error,#dc2626)]"
                  [attr.aria-label]="'Quitar ' + chip.name"
                  [attr.data-testid]="'service-selector-remove-' + chip.id"
                  (click)="removeChip(chip.id)"
                >
                  <app-icon name="x" [size]="12" />
                </button>
              </div>
            </li>
          }
        </ul>
      } @else {
        <p class="rounded-lg border border-dashed border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-text-secondary)]" data-testid="service-selector-empty">
          Aún no has elegido servicios: la sección no muestra ninguno hasta que elijas.
        </p>
      }

      <button
        #openBtn
        type="button"
        class="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs font-semibold text-[var(--color-primary)] hover:bg-[var(--color-background)]"
        aria-haspopup="dialog"
        data-testid="service-selector-open"
        (click)="openModal()"
      >
        <app-icon name="search" [size]="14" />
        {{ selectedIds().length > 0 ? 'Editar selección de servicios' : 'Elegir servicios' }}
      </button>
    </div>

    @if (modalOpen()) {
      <app-modal
        [isOpen]="true"
        title="Seleccionar servicios"
        subtitle="Busca por nombre y elige los servicios en el orden que prefieras."
        size="lg"
        [dialog]="true"
        [closeOnEscape]="true"
        (opened)="onModalOpened()"
        (cancel)="closeModal()"
        (isOpenChange)="onModalOpenChange($event)"
      >
        <div class="space-y-3" data-testid="service-selector-modal">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <label class="relative block min-w-0 flex-1">
              <app-icon
                name="search"
                [size]="14"
                class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]"
              />
              <input
                #searchInput
                type="search"
                class="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-2 pl-9 pr-3 text-sm text-[var(--color-text-primary)]"
                placeholder="Buscar por nombre…"
                aria-label="Buscar servicios por nombre"
                data-testid="service-selector-search"
                [value]="search()"
                (input)="search.set($any($event.target).value)"
              />
            </label>
            <span class="shrink-0 text-xs font-medium text-[var(--color-text-secondary)]" data-testid="service-selector-modal-count">
              {{ draftIds().length }} / {{ max() }} seleccionados
            </span>
          </div>

          @if (isLimitReached()) {
            <p class="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800" role="status" data-testid="service-selector-limit-notice">
              Alcanzaste el máximo de {{ max() }} servicios para esta sección. Quita alguno para elegir otro.
            </p>
          }

          @if (loading()) {
            <div class="flex items-center justify-center py-10">
              <app-spinner size="md" color="primary" />
            </div>
          } @else if (results().length === 0) {
            <div class="flex flex-col items-center justify-center gap-2 py-10 text-center text-sm text-[var(--color-text-secondary)]" data-testid="service-selector-no-results">
              <app-icon name="calendar" [size]="24" />
              <p>{{ catalog().length === 0 ? 'Aún no tienes servicios en línea.' : 'No encontramos servicios que coincidan con tu búsqueda.' }}</p>
            </div>
          } @else {
            <div
              class="max-h-96 divide-y divide-[var(--color-border)] overflow-y-auto rounded-xl border border-[var(--color-border)]"
              role="group"
              aria-label="Resultados de servicios"
              data-testid="service-selector-results"
            >
              @for (service of results(); track service.id) {
                @let selected = isDraftSelected(service.id);
                @let order = draftOrderOf(service.id);
                <button
                  type="button"
                  role="checkbox"
                  class="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-[var(--color-background)] disabled:cursor-not-allowed disabled:opacity-50"
                  [class.bg-[var(--color-primary)]/5]="selected"
                  [attr.aria-checked]="selected"
                  [disabled]="!selected && isLimitReached()"
                  [attr.data-testid]="'service-selector-option-' + service.id"
                  (click)="toggleDraft(service.id)"
                >
                  <span
                    class="flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px] font-bold"
                    [class]="selected
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                      : 'border-[var(--color-border)] bg-[var(--color-surface)] text-transparent'"
                    aria-hidden="true"
                  >
                    @if (order !== null) {
                      {{ order }}
                    }
                  </span>
                  <span class="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-text-secondary)]">
                    @if (service.image_url) {
                      <img [src]="service.image_url" alt="" class="h-full w-full object-cover" loading="lazy" />
                    } @else {
                      <app-icon name="calendar" [size]="16" />
                    }
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-sm font-medium text-[var(--color-text-primary)]">{{ service.name }}</span>
                    @if (durationOf(service); as d) {
                      <span class="mt-0.5 inline-flex items-center gap-1 text-xs text-[var(--color-text-secondary)]" data-testid="service-selector-duration">
                        <app-icon name="clock" [size]="12" /> {{ d }}
                      </span>
                    }
                  </span>
                  <span class="shrink-0 text-sm font-semibold text-[var(--color-text-primary)]" data-testid="service-selector-price">
                    {{ priceOf(service) | currency }}
                  </span>
                </button>
              }
            </div>
          }
        </div>

        <div slot="footer" class="flex w-full items-center justify-between gap-2">
          <span class="text-xs text-[var(--color-text-secondary)]">{{ draftIds().length }} servicio(s) en orden</span>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="h-10 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-background)]"
              data-testid="service-selector-cancel"
              (click)="closeModal()"
            >
              Cancelar
            </button>
            <button
              type="button"
              class="h-10 rounded-xl bg-[var(--color-primary)] px-4 text-sm font-semibold text-white hover:opacity-95"
              data-testid="service-selector-apply"
              (click)="applySelection()"
            >
              Aplicar selección
            </button>
          </div>
        </div>
      </app-modal>
    }
  `,
})
export class AppServiceSelectorComponent {
  private readonly apps = inject(StoreAppsService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly destroyRef = inject(DestroyRef);

  readonly selectedIds = input<readonly number[]>([]);
  readonly max = input(MAX_BLOCK_SERVICE_IDS);
  readonly label = input('Servicios elegidos');

  /** Emite la lista ordenada de IDs elegidos (máximo `max()`). */
  readonly selectedIdsChange = output<number[]>();

  readonly modalOpen = signal(false);
  readonly search = signal('');
  readonly loading = signal(true);
  readonly draftIds = signal<number[]>([]);
  /** Servicios en línea de la tienda (los únicos que la página puede listar). */
  readonly catalog = signal<SelectableService[]>([]);

  private readonly openButton = viewChild<ElementRef<HTMLButtonElement>>('openBtn');
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private focusTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly byId = computed(() => new Map(this.catalog().map((s) => [s.id, s])));

  readonly isLimitReached = computed(() => this.draftIds().length >= this.max());

  readonly results = computed(() => {
    const term = normalize(this.search());
    const list = this.catalog();
    return term ? list.filter((s) => normalize(s.name).includes(term)) : list;
  });

  /** Chips de los ids guardados; uno que ya no está en línea se muestra con su número para poder quitarlo. */
  readonly chips = computed(() => {
    const byId = this.byId();
    return this.selectedIds().map((id) => {
      const found = byId.get(id);
      return { id, name: found?.name ?? `Servicio #${id}`, image_url: found?.image_url ?? null };
    });
  });

  constructor() {
    this.currencyService.loadCurrency();
    this.apps
      .servicePagePreviewContext()
      .pipe(
        map((res) => res?.data?.services ?? []),
        catchError(() => of([] as SelectableService[])),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((services) => {
        this.catalog.set(services);
        this.loading.set(false);
      });
    this.destroyRef.onDestroy(() => this.clearFocusTimer());
  }

  openModal(): void {
    this.draftIds.set(this.sanitizeIds(this.selectedIds()));
    this.modalOpen.set(true);
  }

  /** Mueve el foco al buscador tras el enfoque inicial del diálogo en `app-modal`. */
  onModalOpened(): void {
    this.clearFocusTimer();
    this.focusTimer = setTimeout(() => {
      this.focusTimer = null;
      if (this.modalOpen()) this.searchInput()?.nativeElement.focus();
    }, 0);
  }

  closeModal(): void {
    if (!this.modalOpen()) return;
    this.clearFocusTimer();
    this.modalOpen.set(false);
    this.restoreFocus();
  }

  onModalOpenChange(open: boolean): void {
    if (!open) this.closeModal();
  }

  isDraftSelected(id: number): boolean {
    return this.draftIds().includes(id);
  }

  draftOrderOf(id: number): number | null {
    const idx = this.draftIds().indexOf(id);
    return idx >= 0 ? idx + 1 : null;
  }

  toggleDraft(id: number): void {
    const current = this.draftIds();
    if (current.includes(id)) {
      this.draftIds.set(current.filter((item) => item !== id));
      return;
    }
    if (current.length >= this.max()) return;
    this.draftIds.set([...current, id]);
  }

  applySelection(): void {
    const next = this.sanitizeIds(this.draftIds());
    this.modalOpen.set(false);
    this.selectedIdsChange.emit(next);
    this.restoreFocus();
  }

  removeChip(id: number): void {
    this.selectedIdsChange.emit(this.selectedIds().filter((item) => item !== id));
  }

  moveChip(from: number, to: number): void {
    const list = [...this.selectedIds()];
    if (to < 0 || to >= list.length || from === to) return;
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    this.selectedIdsChange.emit(list);
  }

  durationOf(service: SelectableService): string | null {
    return formatDuration(service.service_duration_minutes, service.service_duration_unit ?? null);
  }

  /** El precio que muestra la página (final, con impuestos y promoción); el regular si el servidor no lo trae. */
  priceOf(service: SelectableService): number {
    return typeof service.final_price === 'number' ? service.final_price : service.price;
  }

  private sanitizeIds(ids: readonly number[]): number[] {
    const seen = new Set<number>();
    const out: number[] = [];
    for (const id of ids) {
      if (out.length >= this.max()) break;
      if (!Number.isInteger(id) || id < 1 || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }

  private clearFocusTimer(): void {
    if (this.focusTimer !== null) {
      clearTimeout(this.focusTimer);
      this.focusTimer = null;
    }
  }

  private restoreFocus(): void {
    this.openButton()?.nativeElement.focus();
  }
}
