import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  HostListener,
  OnInit,
  DestroyRef,
  forwardRef,
  inject,
  input,
  signal,
  computed,
} from '@angular/core';
import {
  ControlValueAccessor,
  NG_VALUE_ACCESSOR,
  FormsModule,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged, forkJoin, of, switchMap, tap } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { IconComponent } from '../icon/icon.component';
import {
  StoreUserLookupService,
  StoreUserOption,
} from '../../services/store-user-lookup.service';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Multiple store-scoped user selector (e.g. route auxiliaries).
 *
 * - Standalone, OnPush, zoneless + signals.
 * - ControlValueAccessor whose value is the selected user ids (`number[]`).
 * - Selected users render as removable chips; remote debounced search.
 * - `excludeIds` removes ids from results (e.g. the already-chosen driver);
 *   already-selected ids are also excluded automatically.
 */
@Component({
  selector: 'app-store-user-multi-select',
  standalone: true,
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => StoreUserMultiSelectComponent),
      multi: true,
    },
  ],
  template: `
    <div class="relative">
      <!-- Selected chips -->
      @if (selected().length > 0) {
        <div class="flex flex-wrap gap-1.5 mb-2">
          @for (user of selected(); track user.id) {
            <span
              class="inline-flex items-center gap-1.5 pl-1 pr-2 py-0.5 text-xs font-medium bg-primary-50 text-primary-600 border border-primary-200 rounded-full"
            >
              <span
                class="w-5 h-5 rounded-full overflow-hidden bg-primary-100 text-primary-600 flex items-center justify-center shrink-0"
              >
                @if (user.avatar_url) {
                  <img
                    [src]="user.avatar_url"
                    [alt]="user.name"
                    class="w-full h-full object-cover"
                  />
                } @else {
                  <span class="text-[10px] font-bold">{{ initial(user.name) }}</span>
                }
              </span>
              <span class="truncate max-w-[10rem]">{{ user.name }}</span>
              @if (!isDisabled()) {
                <button
                  type="button"
                  (click)="remove(user.id, $event)"
                  class="hover:text-primary-800 transition-colors"
                  aria-label="Quitar usuario"
                >
                  <app-icon name="x" [size]="12" />
                </button>
              }
            </span>
          }
        </div>
      }

      <!-- Search input -->
      <div class="relative">
        <input
          type="text"
          [placeholder]="placeholder()"
          [disabled]="isDisabled()"
          [ngModel]="query()"
          (ngModelChange)="onQueryChange($event)"
          (focus)="openDropdown()"
          (keydown.escape)="closeDropdown()"
          class="w-full px-3 py-2 pr-8 text-sm border border-border rounded-lg bg-[var(--color-surface)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] focus:border-[var(--color-primary)] placeholder-[var(--color-text-secondary)] disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <app-icon
          name="search"
          [size]="14"
          class="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)] pointer-events-none"
        />
      </div>

      <!-- Dropdown -->
      @if (isOpen()) {
        <div
          class="absolute z-[10000] left-0 right-0 bg-[var(--color-surface)] border border-border rounded-lg shadow-lg max-h-64 overflow-y-auto"
          [class.top-full]="!dropUp()"
          [class.mt-1]="!dropUp()"
          [class.bottom-full]="dropUp()"
          [class.mb-1]="dropUp()"
        >
          @if (isLoading()) {
            <div class="flex items-center justify-center gap-2 p-4 text-sm text-[var(--color-text-secondary)]">
              <app-icon name="loader-2" [size]="16" [spin]="true" />
              Buscando...
            </div>
          } @else if (visibleResults().length === 0) {
            <div class="p-4 text-center text-sm text-[var(--color-text-secondary)]">
              @if (query().trim()) {
                No se encontraron usuarios
              } @else {
                Escribe para buscar usuarios
              }
            </div>
          } @else {
            @for (user of visibleResults(); track user.id) {
              <button
                type="button"
                class="w-full flex items-center gap-3 px-3 py-2 hover:bg-primary-50 transition-colors text-left"
                (mousedown)="add(user)"
              >
                <div
                  class="w-8 h-8 rounded-full overflow-hidden bg-primary-50 text-primary-600 flex items-center justify-center shrink-0"
                >
                  @if (user.avatar_url) {
                    <img
                      [src]="user.avatar_url"
                      [alt]="user.name"
                      class="w-full h-full object-cover"
                    />
                  } @else {
                    <span class="text-xs font-bold">{{ initial(user.name) }}</span>
                  }
                </div>
                <div class="min-w-0 flex-1">
                  <p class="text-sm font-medium text-[var(--color-text-primary)] truncate">
                    {{ user.name }}
                  </p>
                  @if (user.email) {
                    <p class="text-xs text-[var(--color-text-secondary)] truncate">
                      {{ user.email }}
                    </p>
                  }
                </div>
              </button>
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
export class StoreUserMultiSelectComponent
  implements ControlValueAccessor, OnInit
{
  private readonly lookup = inject(StoreUserLookupService);
  private readonly elementRef = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly searchSubject = new Subject<string>();

  readonly placeholder = input<string>('Buscar usuario...');
  readonly disabled = input<boolean>(false);
  /** Extra user ids to exclude from results (e.g. an already-chosen driver). */
  readonly excludeIds = input<number[]>([]);
  /**
   * Role name to exclude server-side (e.g. `'customer'` for staff-only
   * pickers). Opt-in — defaults to `null` so existing consumers keep the
   * full store-user list.
   */
  readonly excludeRole = input<string | null>(null);

  // Signal UI state (zoneless-safe)
  readonly query = signal<string>('');
  readonly selected = signal<StoreUserOption[]>([]);
  readonly results = signal<StoreUserOption[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly isOpen = signal<boolean>(false);
  /** When true the dropdown opens upward (not enough room below, e.g. in a modal). */
  readonly dropUp = signal<boolean>(false);
  private readonly disabledState = signal<boolean>(false);

  /** Approx. dropdown height (max-h-64 = 16rem = 256px + margin). */
  private static readonly DROPDOWN_MAX_PX = 264;

  /** Selected ids, used both for emission and result de-duplication. */
  private readonly selectedIds = computed(() => this.selected().map((u) => u.id));

  /** Search results minus already-selected and externally-excluded ids. */
  readonly visibleResults = computed<StoreUserOption[]>(() => {
    const excluded = new Set([...this.selectedIds(), ...this.excludeIds()]);
    return this.results().filter((u) => !excluded.has(u.id));
  });

  // ControlValueAccessor callbacks
  private onChange: (value: number[]) => void = () => {};
  private onTouched: () => void = () => {};

  ngOnInit(): void {
    this.searchSubject
      .pipe(
        debounceTime(SEARCH_DEBOUNCE_MS),
        distinctUntilChanged(),
        tap(() => this.isLoading.set(true)),
        switchMap((term) =>
          this.lookup
            .search(term, {
              excludeIds: this.excludeIds(),
              excludeRole: this.excludeRole() ?? undefined,
            })
            .pipe(catchError(() => of([] as StoreUserOption[]))),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((options) => {
        this.isLoading.set(false);
        this.results.set(options);
      });
  }

  // ── ControlValueAccessor ──────────────────────────────────────────────
  writeValue(value: number[] | null): void {
    const ids = value ?? [];
    if (ids.length === 0) {
      this.selected.set([]);
      return;
    }
    // Resolve name/avatar for each incoming id.
    forkJoin(ids.map((id) => this.lookup.getById(id)))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((resolved) => {
        this.selected.set(
          resolved.map((user, index) =>
            user ?? { id: ids[index], name: `Usuario #${ids[index]}` },
          ),
        );
      });
  }

  registerOnChange(fn: (value: number[]) => void): void {
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
    this.computeDropDirection();
    this.isOpen.set(true);
    this.searchSubject.next(term);
  }

  openDropdown(): void {
    if (this.isDisabled()) return;
    this.computeDropDirection();
    this.isOpen.set(true);
    this.searchSubject.next(this.query());
  }

  /**
   * Decide whether the dropdown should open upward. Opens up only when the
   * space below the control is smaller than the dropdown AND there is more
   * room above — otherwise keep the default downward direction. Measured with
   * `getBoundingClientRect` (zoneless-safe, no NgZone) right before opening.
   */
  private computeDropDirection(): void {
    if (typeof window === 'undefined') return;
    const rect = (
      this.elementRef.nativeElement as HTMLElement
    ).getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const max = StoreUserMultiSelectComponent.DROPDOWN_MAX_PX;
    this.dropUp.set(spaceBelow < max && spaceAbove > spaceBelow);
  }

  closeDropdown(): void {
    this.isOpen.set(false);
  }

  add(user: StoreUserOption): void {
    if (this.isDisabled()) return;
    if (this.selectedIds().includes(user.id)) return;
    this.selected.update((current) => [...current, user]);
    this.query.set('');
    this.isOpen.set(false);
    this.emit();
  }

  remove(id: number, event: Event): void {
    event.stopPropagation();
    if (this.isDisabled()) return;
    this.selected.update((current) => current.filter((u) => u.id !== id));
    this.emit();
  }

  initial(name: string): string {
    return (name?.charAt(0) || '?').toUpperCase();
  }

  private emit(): void {
    this.onChange(this.selectedIds());
    this.onTouched();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.isOpen()) return;
    const path = event.composedPath();
    const isInside = path.some((node) => node === this.elementRef.nativeElement);
    if (!isInside) {
      this.isOpen.set(false);
      this.onTouched();
    }
  }
}
