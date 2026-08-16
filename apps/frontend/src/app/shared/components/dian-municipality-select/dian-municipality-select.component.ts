import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  OnInit,
  effect,
  forwardRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  ControlValueAccessor,
  FormsModule,
  NG_VALUE_ACCESSOR,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged, of, switchMap, tap } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { IconComponent } from '../icon/icon.component';
import {
  DianMunicipalityLookupService,
  DianMunicipalityOption,
  DianMunicipalitySearchResult,
} from '../../services/dian-municipality-lookup.service';

const SEARCH_DEBOUNCE_MS = 300;

const EMPTY_RESULT: DianMunicipalitySearchResult = {
  items: [],
  total: 0,
  hasMore: false,
};

/**
 * Selector buscable del municipio DANE (Divipola) de una dirección.
 *
 * Por qué existe: `addresses.municipality_code` es un bloqueante duro de la
 * facturación electrónica (`CITY_CODE_REQUIRED`) y no había ninguna pantalla
 * donde capturarlo — el catálogo estaba en el repo sin un solo importador y el
 * geocodificador devuelve `municipality_code: null` a propósito.
 *
 * Decisiones:
 *
 * - **Buscable, no `<select>`.** Son 1122 municipios. Se teclea y el servidor
 *   filtra, con `debounceTime → distinctUntilChanged → switchMap`, igual que
 *   `app-account-select` y `app-store-user-select`.
 * - **El valor es el código DANE (`string | null`)**, que es exactamente lo que
 *   se persiste en la columna.
 * - **El departamento viaja con el municipio.** Cada opción trae
 *   `department_code`/`department_name`, y el componente los publica en
 *   {@link municipalitySelected} para que el formulario padre sincronice ciudad
 *   y departamento. Así no existe una combinación municipio/departamento
 *   imposible: no hay dos campos que puedan discrepar, hay uno solo.
 *
 * Zoneless + Signals: sin NgZone, sin markForCheck, sin @Input/@Output.
 */
@Component({
  selector: 'app-dian-municipality-select',
  standalone: true,
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => DianMunicipalitySelectComponent),
      multi: true,
    },
  ],
  template: `
    <div class="relative">
      @if (!isOpen()) {
        <!-- Colapsado: chip del municipio elegido, o disparador vacío -->
        <div
          class="flex items-center justify-between gap-2 px-3 py-2 border border-border rounded-lg bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] transition-colors"
          [class.opacity-50]="isDisabled()"
          [class.cursor-pointer]="!isDisabled()"
          [class.cursor-not-allowed]="isDisabled()"
          role="button"
          tabindex="0"
          [attr.aria-disabled]="isDisabled()"
          (click)="openDropdown()"
          (keydown.enter)="openDropdown()"
          (keydown.space)="openDropdown()"
        >
          @if (selected(); as municipality) {
            <div class="flex items-center gap-2 min-w-0">
              <span
                class="text-xs font-mono font-semibold text-primary-600 shrink-0"
                >{{ municipality.code }}</span
              >
              <span
                class="text-sm text-[var(--color-text-primary)] truncate"
                [title]="municipality.name + ' — ' + municipality.department_name"
                >{{ municipality.name }}</span
              >
              <span
                class="shrink-0 text-xs text-[var(--color-text-secondary)] truncate"
                >{{ municipality.department_name }}</span
              >
            </div>
            @if (!isDisabled()) {
              <button
                type="button"
                (click)="clear($event)"
                class="p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-destructive)] shrink-0"
                aria-label="Quitar municipio"
              >
                <app-icon name="x" [size]="14" />
              </button>
            }
          } @else if (isHydrating()) {
            <span
              class="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]"
            >
              <app-icon name="loader-2" [size]="14" [spin]="true" />
              Cargando municipio...
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
        <!-- Expandido: caja de búsqueda remota -->
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
                No se encontraron municipios para "{{ query().trim() }}"
              } @else {
                No hay municipios disponibles
              }
            </div>
          } @else {
            @for (municipality of results(); track municipality.code) {
              <button
                type="button"
                class="w-full flex items-center gap-2 px-3 py-2 hover:bg-primary-50 transition-colors text-left"
                [class.bg-primary-50]="municipality.code === selectedCode()"
                (mousedown)="select(municipality)"
              >
                <span
                  class="text-xs font-mono font-semibold text-primary-600 shrink-0 w-12"
                  >{{ municipality.code }}</span
                >
                <span
                  class="text-sm text-[var(--color-text-primary)] truncate flex-1"
                  >{{ municipality.name }}</span
                >
                <span
                  class="text-xs text-[var(--color-text-secondary)] shrink-0 truncate max-w-[9rem]"
                  >{{ municipality.department_name }}</span
                >
              </button>
            }

            @if (hasMore()) {
              <p
                class="px-3 py-2 text-xs text-center text-[var(--color-text-secondary)] border-t border-border"
              >
                Mostrando {{ results().length }} de {{ total() }} municipios —
                escribe el nombre o el código DANE para filtrar
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
export class DianMunicipalitySelectComponent
  implements ControlValueAccessor, OnInit
{
  private readonly lookup = inject(DianMunicipalityLookupService);
  private readonly elementRef = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  /**
   * Términos de búsqueda, etiquetados con la sesión del desplegable.
   *
   * El contador de sesión es lo que hace seguro a `distinctUntilChanged` entre
   * ciclos abrir/cerrar: sin él, buscar «medell», cerrar, reabrir y volver a
   * teclear «medell» se descartaría como duplicado y el usuario se quedaría
   * mirando resultados rancios.
   */
  private readonly searchSubject = new Subject<{
    session: number;
    term: string;
  }>();
  private searchSession = 0;

  /** Solo existe mientras `@if (isOpen())` lo renderiza → query signal. */
  private readonly searchInput =
    viewChild<ElementRef<HTMLInputElement>>('searchInput');

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        this.searchInput()?.nativeElement.focus();
      }
    });
  }

  readonly placeholder = input<string>('Selecciona el municipio');
  readonly searchPlaceholder = input<string>(
    'Buscar por municipio, departamento o código DANE...',
  );
  readonly disabled = input<boolean>(false);

  /**
   * Municipio completo elegido (o `null` al limpiar).
   *
   * El CVA solo puede publicar el código, pero el formulario padre necesita el
   * departamento para mantener coherentes `city` y `state_province`. Esta
   * salida es ese canal.
   */
  readonly municipalitySelected = output<DianMunicipalityOption | null>();

  // Estado de UI en signals (zoneless-safe: todo lo que lee la plantilla es signal)
  readonly query = signal<string>('');
  readonly selected = signal<DianMunicipalityOption | null>(null);
  readonly results = signal<DianMunicipalityOption[]>([]);
  readonly total = signal<number>(0);
  readonly hasMore = signal<boolean>(false);
  readonly isLoading = signal<boolean>(false);
  readonly isHydrating = signal<boolean>(false);
  readonly isOpen = signal<boolean>(false);
  /** Deshabilitado escrito por reactive forms vía `setDisabledState`. */
  private readonly disabledState = signal<boolean>(false);
  /** Código crudo mientras el municipio detrás se está resolviendo. */
  private readonly pendingCode = signal<string | null>(null);

  readonly selectedCode = signal<string | null>(null);

  // Callbacks del ControlValueAccessor
  private onChange: (value: string | null) => void = () => {};
  private onTouched: () => void = () => {};

  ngOnInit(): void {
    this.searchSubject
      .pipe(
        debounceTime(SEARCH_DEBOUNCE_MS),
        distinctUntilChanged(
          (a, b) => a.session === b.session && a.term === b.term,
        ),
        tap(() => this.isLoading.set(true)),
        // `switchMap` cancela la petición anterior: quien teclea rápido nunca
        // ve una respuesta vieja pisar a una nueva.
        switchMap(({ term }) =>
          this.lookup.search(term).pipe(catchError(() => of(EMPTY_RESULT))),
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
   * El municipio guardado casi nunca está en la primera página, así que se
   * resuelve explícitamente. Sin esto, abrir un cliente en modo edición
   * mostraría el campo vacío sobre un valor que sí está puesto — y un
   * «Guardar» a ciegas lo borraría.
   */
  writeValue(value: string | null): void {
    const code =
      typeof value === 'string' && value.trim() ? value.trim() : null;

    this.selectedCode.set(code);

    if (!code) {
      this.pendingCode.set(null);
      this.selected.set(null);
      this.isHydrating.set(false);
      return;
    }

    if (this.selected()?.code === code) return;

    this.pendingCode.set(code);
    this.selected.set(null);
    this.isHydrating.set(true);
    this.lookup
      .resolveByCode(code)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((municipality) => {
        this.isHydrating.set(false);
        // ¿Sigue siendo el valor que nos pidieron pintar? Puede haber llegado
        // otro writeValue mientras esta petición estaba en vuelo.
        if (this.pendingCode() !== code) return;
        this.selected.set(
          municipality ?? {
            code,
            name: 'Municipio no encontrado',
            department_code: code.slice(0, 2),
            department_name: '',
            postal_code: '',
          },
        );
      });
  }

  registerOnChange(fn: (value: string | null) => void): void {
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

  // ── Handlers de UI ────────────────────────────────────────────────────
  onQueryChange(term: string): void {
    this.query.set(term);
    this.searchSubject.next({ session: this.searchSession, term });
  }

  openDropdown(): void {
    if (this.isDisabled()) return;
    this.isOpen.set(true);
    this.query.set('');
    this.searchSession += 1;
    this.isLoading.set(true);
    this.lookup
      .search('')
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

  select(municipality: DianMunicipalityOption): void {
    this.pendingCode.set(municipality.code);
    this.selectedCode.set(municipality.code);
    this.selected.set(municipality);
    this.results.set([]);
    this.closeDropdown();
    this.onChange(municipality.code);
    this.onTouched();
    this.municipalitySelected.emit(municipality);
  }

  clear(event: Event): void {
    event.stopPropagation();
    if (this.isDisabled()) return;
    this.pendingCode.set(null);
    this.selectedCode.set(null);
    this.selected.set(null);
    this.results.set([]);
    this.onChange(null);
    this.onTouched();
    this.municipalitySelected.emit(null);
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
