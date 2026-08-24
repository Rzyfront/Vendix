import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  ElementRef,
  HostListener,
  OnInit,
  computed,
  effect,
  forwardRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import {
  ControlValueAccessor,
  NG_VALUE_ACCESSOR,
  FormsModule,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  Subject,
  debounceTime,
  distinctUntilChanged,
  of,
  switchMap,
  tap,
} from 'rxjs';
import { catchError } from 'rxjs/operators';
import { IconComponent } from '../icon/icon.component';
import {
  ChartAccountLookupService,
  ChartAccountLookupOptions,
  ChartAccountOption,
  ChartAccountScope,
  ChartAccountSearchResult,
} from '../../services/chart-account-lookup.service';

const SEARCH_DEBOUNCE_MS = 300;
/**
 * Tope de filas del desplegable, EN LAS DOS RUTAS: la lista en reposo y la
 * búsqueda tecleada.
 *
 * Antes eran dos números —5 en reposo, 20 al teclear— y eso hacía que el mismo
 * selector devolviera 8 resultados a «mercancías» con el pie diciendo que
 * mostraba todo. El requisito es «máximo 5 resultados», así que el tope es uno
 * solo: pasado el quinto, el pie invita a afinar en vez de crecer.
 *
 * Cinco filas caben sin scroll en `max-h-64`, que es lo que hace que la lista se
 * lea de un vistazo en lugar de ojearse.
 */
const MAX_RESULTS = 5;

const EMPTY_RESULT: ChartAccountSearchResult = {
  items: [],
  total: 0,
  hasMore: false,
};

/**
 * PUC account selector with server-side search.
 *
 * - Standalone, OnPush, zoneless + signals.
 * - ControlValueAccessor whose value is the account id (`number | null`).
 * - Loads at most {@link MAX_RESULTS} accounts; everything else is
 *   reached by typing, debounced and cancelled through `switchMap`.
 * - Searches by **code or name** — the backend ORs both columns, so `4135` and
 *   `comercio` are equally valid queries.
 *
 * Deliberately mirrors `app-store-user-select` (same CVA shape, same
 * `debounceTime → distinctUntilChanged → switchMap` pipeline, same outside-click
 * handling) so the two selectors behave identically.
 *
 * The one behavioural difference: opening a selector that already has a value
 * swaps the chip for the search box in place, instead of requiring the user to
 * clear the selection first. With ~230 pre-filled rows in the mappings form,
 * "clear, then search" would be one wasted click per row.
 */
@Component({
  selector: 'app-account-select',
  standalone: true,
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => AccountSelectComponent),
      multi: true,
    },
  ],
  template: `
    <div class="relative">
      @if (!isOpen()) {
        <!-- Collapsed: selected account chip, or an empty trigger -->
        <div
          class="flex items-center justify-between gap-2 px-3 py-2 border border-border rounded-lg bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] transition-colors"
          [class.opacity-50]="isDisabled()"
          [class.cursor-pointer]="!isDisabled()"
          [class.cursor-not-allowed]="isDisabled()"
          role="button"
          tabindex="0"
          [attr.aria-label]="ariaLabel() || null"
          [attr.aria-disabled]="isDisabled()"
          (click)="openDropdown()"
          (keydown.enter)="openDropdown()"
          (keydown.space)="openDropdown()"
        >
          @if (selected(); as account) {
            <div class="flex items-center gap-2 min-w-0">
              <span
                class="text-xs font-mono font-semibold text-primary-600 shrink-0"
                >{{ account.code }}</span
              >
              <span
                class="text-sm text-[var(--color-text-primary)] truncate"
                [title]="account.name"
                >{{ account.name }}</span
              >
              @if (!account.accepts_entries) {
                <span
                  class="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]"
                  title="Cuenta de agrupación: no acepta movimientos"
                  >Agrupación</span
                >
              }
            </div>
            @if (!isDisabled()) {
              <button
                type="button"
                (click)="clear($event)"
                class="p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-destructive)] shrink-0"
                aria-label="Quitar cuenta"
              >
                <app-icon name="x" [size]="14" />
              </button>
            }
          } @else if (isHydrating()) {
            <span
              class="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]"
            >
              <app-icon name="loader-2" [size]="14" [spin]="true" />
              Cargando cuenta...
            </span>
          } @else {
            <span class="text-sm text-[var(--color-text-secondary)] truncate">{{
              placeholder()
            }}</span>
            <app-icon
              name="chevron-down"
              [size]="14"
              class="text-[var(--color-text-secondary)] shrink-0"
            />
          }
        </div>
      } @else {
        <!-- Expanded: remote search box -->
        <div class="relative">
          <input
            #searchInput
            type="text"
            [placeholder]="searchPlaceholder()"
            [disabled]="isDisabled()"
            [ngModel]="query()"
            (ngModelChange)="onQueryChange($event)"
            (keydown.escape)="closeDropdown()"
            class="w-full px-3 py-2 pr-8 text-sm border border-border rounded-lg bg-[var(--color-surface)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] focus:border-[var(--color-primary)] placeholder-[var(--color-text-secondary)] disabled:opacity-50 disabled:cursor-not-allowed"
            autocomplete="off"
          />
          <app-icon
            name="search"
            [size]="14"
            class="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)] pointer-events-none"
          />
        </div>

        <div
          class="absolute z-[10000] top-full left-0 right-0 mt-1 bg-[var(--color-surface)] border border-border rounded-lg shadow-lg max-h-64 overflow-y-auto"
        >
          @if (isLoading()) {
            <div
              class="flex items-center justify-center gap-2 p-4 text-sm text-[var(--color-text-secondary)]"
            >
              <app-icon name="loader-2" [size]="16" [spin]="true" />
              Buscando...
            </div>
          } @else if (results().length === 0) {
            <div class="p-4 text-center text-sm text-[var(--color-text-secondary)]">
              @if (query().trim()) {
                No se encontraron cuentas para "{{ query().trim() }}"
              } @else {
                No hay cuentas disponibles
              }
            </div>
          } @else {
            @for (account of results(); track account.id) {
              <button
                type="button"
                class="w-full flex items-center gap-2 px-3 py-2 hover:bg-primary-50 transition-colors text-left"
                [class.bg-primary-50]="account.id === selectedId()"
                (mousedown)="select(account)"
              >
                <span
                  class="text-xs font-mono font-semibold text-primary-600 shrink-0 w-16"
                  >{{ account.code }}</span
                >
                <span
                  class="text-sm text-[var(--color-text-primary)] truncate flex-1"
                  >{{ account.name }}</span
                >
                @if (account.accepts_entries) {
                  <app-icon
                    name="check"
                    [size]="12"
                    class="text-[var(--color-success,#16a34a)] shrink-0"
                    title="Acepta movimientos"
                  />
                } @else {
                  <app-icon
                    name="folder"
                    [size]="12"
                    class="text-[var(--color-text-secondary)] shrink-0"
                    title="Cuenta de agrupación: no acepta movimientos"
                  />
                }
              </button>
            }

            @if (hasMore()) {
              <p
                class="px-3 py-2 text-xs text-center text-[var(--color-text-secondary)] border-t border-border"
              >
                Mostrando {{ results().length }} de {{ total() }} cuentas —
                @if (query().trim()) {
                  afina la búsqueda para ver el resto
                } @else {
                  escribe código o nombre para filtrar
                }
              </p>
            }
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        position: relative;
      }
    `,
  ],
})
export class AccountSelectComponent implements ControlValueAccessor, OnInit {
  private readonly lookup = inject(ChartAccountLookupService);
  private readonly elementRef = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  /**
   * Search terms, tagged with the dropdown session they belong to.
   *
   * The session counter is what makes `distinctUntilChanged` safe across
   * open/close cycles: without it, closing after searching `4135` and then
   * reopening and typing `4135` again would be swallowed as a duplicate and
   * the user would stare at stale results.
   */
  private readonly searchSubject = new Subject<{
    session: number;
    term: string;
  }>();
  private searchSession = 0;

  /**
   * Search box reference. It only exists while `@if (isOpen())` renders it, so
   * it is a query signal: it resolves post-render and drives the autofocus
   * effect. Same pattern as `SelectorComponent`'s searchable mode.
   */
  private readonly searchInput =
    viewChild<ElementRef<HTMLInputElement>>('searchInput');

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        this.searchInput()?.nativeElement.focus();
      }
    });
  }

  readonly placeholder = input<string>('Seleccione cuenta');
  readonly searchPlaceholder = input<string>('Buscar por código o nombre...');
  readonly disabled = input<boolean>(false);
  /**
   * Nombre accesible del disparador.
   *
   * El disparador es un `div role="button"`, que NO es un elemento etiquetable:
   * un `<label>` externo no se le asocia por más que se pinte al lado. Sin esto,
   * un formulario con varias cuentas —el mapeo AIU son tres seguidas— se
   * anuncia como tres botones idénticos que dicen sólo su placeholder, y el
   * lector de pantalla no puede distinguir Administración de Utilidad.
   */
  readonly ariaLabel = input<string>('');
  /** `'organization'` routes the lookup to the org controller. */
  readonly scope = input<ChartAccountScope>('store');
  /** Narrows an org-level read to a single store. */
  readonly storeId = input<number | null>(null);
  /** Hide grouping accounts (the ledger cannot post to them). Default `true`. */
  readonly acceptsEntriesOnly = input<boolean>(true);

  // Signal UI state (zoneless-safe: every field the template reads is a signal)
  readonly query = signal<string>('');
  readonly selected = signal<ChartAccountOption | null>(null);
  readonly results = signal<ChartAccountOption[]>([]);
  readonly total = signal<number>(0);
  readonly hasMore = signal<boolean>(false);
  readonly isLoading = signal<boolean>(false);
  readonly isHydrating = signal<boolean>(false);
  readonly isOpen = signal<boolean>(false);
  /** Disabled flag written by reactive forms via `setDisabledState`. */
  private readonly disabledState = signal<boolean>(false);
  /** Raw value held while the account behind it is still being resolved. */
  private readonly pendingValue = signal<number | null>(null);

  readonly selectedId = computed(
    () => this.selected()?.id ?? this.pendingValue(),
  );

  // ControlValueAccessor callbacks
  private onChange: (value: number | null) => void = () => {};
  private onTouched: () => void = () => {};

  ngOnInit(): void {
    this.searchSubject
      .pipe(
        debounceTime(SEARCH_DEBOUNCE_MS),
        distinctUntilChanged(
          (a, b) => a.session === b.session && a.term === b.term,
        ),
        tap(() => this.isLoading.set(true)),
        // `switchMap` cancels the previous request, so a fast typist never
        // sees an older response overwrite a newer one.
        switchMap(({ term }) =>
          this.lookup
            .search(term, this.lookupOptions(term))
            .pipe(catchError(() => of(EMPTY_RESULT))),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        this.isLoading.set(false);
        this.results.set(res.items);
        this.total.set(res.total);
        this.hasMore.set(res.hasMore);
      });
  }

  // ── ControlValueAccessor ──────────────────────────────────────────────
  /**
   * The stored account is almost never inside the initial page, so it is
   * resolved explicitly instead of being looked up in `results()`. Without
   * this, opening a form in edit mode would render an empty field over a value
   * that is actually set — and a blind "Guardar" would then wipe it.
   */
  writeValue(value: number | string | null): void {
    const numeric =
      value == null || value === '' ? null : Number(value);

    if (numeric == null || Number.isNaN(numeric)) {
      this.pendingValue.set(null);
      this.selected.set(null);
      this.isHydrating.set(false);
      return;
    }

    if (this.selected()?.id === numeric) {
      return;
    }

    this.pendingValue.set(numeric);
    this.selected.set(null);
    this.isHydrating.set(true);
    this.lookup
      // Hydration must not be filtered by `acceptsEntriesOnly`: a legacy
      // mapping may point at a grouping account and it still has to render.
      .resolveById(numeric, {
        scope: this.scope(),
        storeId: this.storeId(),
        acceptsEntriesOnly: false,
        activeOnly: false,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((account) => {
        this.isHydrating.set(false);
        // Still the value we were asked to render? A second writeValue may
        // have landed while this request was in flight.
        if (this.pendingValue() !== numeric) return;
        this.selected.set(
          account ?? {
            id: numeric,
            code: `#${numeric}`,
            name: 'Cuenta no encontrada',
            accepts_entries: false,
          },
        );
      });
  }

  registerOnChange(fn: (value: number | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabledState.set(isDisabled);
  }

  isDisabled(): boolean {
    return this.disabled() || this.disabledState();
  }

  // ── UI handlers ───────────────────────────────────────────────────────
  onQueryChange(term: string): void {
    this.query.set(term);
    this.searchSubject.next({ session: this.searchSession, term });
  }

  openDropdown(): void {
    if (this.isDisabled()) return;
    this.isOpen.set(true);
    this.query.set('');
    this.searchSession += 1;
    // First page ("sólo 5") — cached per context in the lookup service, so the
    // ~230 selectors of the mappings form share a single request.
    this.isLoading.set(true);
    this.lookup
      .firstPage(this.lookupOptions(''))
      .pipe(
        catchError(() => of(EMPTY_RESULT)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((res) => {
        this.isLoading.set(false);
        this.results.set(res.items);
        this.total.set(res.total);
        this.hasMore.set(res.hasMore);
      });
  }

  closeDropdown(): void {
    this.isOpen.set(false);
    this.query.set('');
  }

  select(account: ChartAccountOption): void {
    this.pendingValue.set(account.id);
    this.selected.set(account);
    this.results.set([]);
    this.closeDropdown();
    this.onChange(account.id);
    this.onTouched();
  }

  clear(event: Event): void {
    event.stopPropagation();
    if (this.isDisabled()) return;
    this.pendingValue.set(null);
    this.selected.set(null);
    this.results.set([]);
    this.onChange(null);
    this.onTouched();
  }

  private lookupOptions(term: string): ChartAccountLookupOptions {
    return {
      scope: this.scope(),
      storeId: this.storeId(),
      acceptsEntriesOnly: this.acceptsEntriesOnly(),
      limit: MAX_RESULTS,
    };
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.isOpen()) return;
    const path = event.composedPath();
    const isInside = path.some((node) => node === this.elementRef.nativeElement);
    if (!isInside) {
      this.closeDropdown();
      this.onTouched();
    }
  }
}
