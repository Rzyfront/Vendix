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
} from '@angular/core';
import {
  ControlValueAccessor,
  NG_VALUE_ACCESSOR,
  FormsModule,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged, of, switchMap, tap } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { IconComponent } from '../icon/icon.component';
import {
  StoreUserLookupService,
  StoreUserOption,
} from '../../services/store-user-lookup.service';

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Single store-scoped user selector.
 *
 * - Standalone, OnPush, zoneless + signals.
 * - ControlValueAccessor whose value is the selected user id (`number | null`).
 * - Remote debounced search via {@link StoreUserLookupService}.
 *
 * The search pattern mirrors the organization `user-select` component, but this
 * one is store-scoped and a proper CVA (instead of a `model()`), so it can be
 * driven by reactive forms in the remision / planilla / vehicle flows.
 */
@Component({
  selector: 'app-store-user-select',
  standalone: true,
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => StoreUserSelectComponent),
      multi: true,
    },
  ],
  template: `
    <div class="relative">
      @if (selected(); as user) {
        <!-- Selected user chip -->
        <div
          class="flex items-center justify-between p-2 border border-border rounded-lg bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] transition-colors"
          [class.opacity-50]="isDisabled()"
          [class.cursor-pointer]="!isDisabled()"
          [class.cursor-not-allowed]="isDisabled()"
          (click)="openDropdown()"
        >
          <div class="flex items-center gap-2 min-w-0">
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
            <div class="min-w-0">
              <p class="text-sm font-medium text-[var(--color-text-primary)] truncate">
                {{ user.name }}
              </p>
              @if (user.email) {
                <p class="text-xs text-[var(--color-text-secondary)] truncate">
                  {{ user.email }}
                </p>
              }
            </div>
          </div>
          @if (!isDisabled()) {
            <button
              type="button"
              (click)="clear($event)"
              class="p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-destructive)] shrink-0"
              aria-label="Quitar usuario"
            >
              <app-icon name="x" [size]="14" />
            </button>
          }
        </div>
      } @else {
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
      }

      <!-- Dropdown -->
      @if (isOpen() && !selected()) {
        <div
          class="absolute z-[10000] top-full left-0 right-0 mt-1 bg-[var(--color-surface)] border border-border rounded-lg shadow-lg max-h-64 overflow-y-auto"
        >
          @if (isLoading()) {
            <div class="flex items-center justify-center gap-2 p-4 text-sm text-[var(--color-text-secondary)]">
              <app-icon name="loader-2" [size]="16" [spin]="true" />
              Buscando...
            </div>
          } @else if (results().length === 0) {
            <div class="p-4 text-center text-sm text-[var(--color-text-secondary)]">
              @if (query().trim()) {
                No se encontraron usuarios
              } @else {
                Escribe para buscar usuarios
              }
            </div>
          } @else {
            @for (user of results(); track user.id) {
              <button
                type="button"
                class="w-full flex items-center gap-3 px-3 py-2 hover:bg-primary-50 transition-colors text-left"
                (mousedown)="select(user)"
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
export class StoreUserSelectComponent implements ControlValueAccessor, OnInit {
  private readonly lookup = inject(StoreUserLookupService);
  private readonly elementRef = inject(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly searchSubject = new Subject<string>();

  readonly placeholder = input<string>('Buscar usuario...');
  readonly disabled = input<boolean>(false);
  /** User ids to exclude from search results (e.g. an already-chosen driver). */
  readonly excludeIds = input<number[]>([]);

  // Signal UI state (zoneless-safe)
  readonly query = signal<string>('');
  readonly selected = signal<StoreUserOption | null>(null);
  readonly results = signal<StoreUserOption[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly isOpen = signal<boolean>(false);
  /** Disabled flag written by reactive forms via `setDisabledState`. */
  private readonly disabledState = signal<boolean>(false);

  // ControlValueAccessor callbacks
  private onChange: (value: number | null) => void = () => {};
  private onTouched: () => void = () => {};

  ngOnInit(): void {
    this.searchSubject
      .pipe(
        debounceTime(SEARCH_DEBOUNCE_MS),
        distinctUntilChanged(),
        tap(() => this.isLoading.set(true)),
        switchMap((term) =>
          this.lookup
            .search(term, { excludeIds: this.excludeIds() })
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
  writeValue(value: number | null): void {
    if (value == null) {
      this.selected.set(null);
      return;
    }
    // Resolve name/avatar for the incoming id.
    this.lookup
      .getById(value)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((user) =>
        this.selected.set(user ?? { id: value, name: `Usuario #${value}` }),
      );
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
    this.isOpen.set(true);
    this.searchSubject.next(term);
  }

  openDropdown(): void {
    if (this.isDisabled()) return;
    this.isOpen.set(true);
    if (!this.selected()) {
      this.searchSubject.next(this.query());
    }
  }

  closeDropdown(): void {
    this.isOpen.set(false);
  }

  select(user: StoreUserOption): void {
    this.selected.set(user);
    this.query.set('');
    this.results.set([]);
    this.isOpen.set(false);
    this.onChange(user.id);
    this.onTouched();
  }

  clear(event: Event): void {
    event.stopPropagation();
    if (this.isDisabled()) return;
    this.selected.set(null);
    this.query.set('');
    this.results.set([]);
    this.onChange(null);
    this.onTouched();
  }

  initial(name: string): string {
    return (name?.charAt(0) || '?').toUpperCase();
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
