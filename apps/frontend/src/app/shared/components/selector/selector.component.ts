import {
  Component,
  forwardRef,
  inject,
  signal,
  computed,
  input,
  output,
  effect,
  viewChild,
  ElementRef,
  HostListener,
} from '@angular/core';

import {
  ControlValueAccessor,
  NG_VALUE_ACCESSOR,
  FormsModule,
  ReactiveFormsModule,
} from '@angular/forms';
import { IconComponent } from '../icon/icon.component';
import { TooltipComponent } from '../tooltip/tooltip.component';
import { FormStyleVariant } from '../../types/form.types';

export interface SelectorOption {
  value: string | number;
  label: string;
  disabled?: boolean;
  description?: string;
  icon?: string;
  /** URL de miniatura opcional; si está presente, el modo searchable la
   * renderiza como avatar a la izquierda del label. Aditivo/retrocompatible. */
  imageUrl?: string;
}

export type SelectorSize = 'sm' | 'md' | 'lg';
export type SelectorVariant = 'default' | 'outline' | 'filled';

@Component({
  selector: 'app-selector',
  standalone: true,
  imports: [FormsModule, ReactiveFormsModule, IconComponent, TooltipComponent],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => SelectorComponent),
      multi: true,
    },
  ],
  template: `
    <div [class]="containerClasses">
      @if (label()) {
        <label
          [class]="labelClasses"
          [for]="id()"
          class="label-with-tooltip"
          >
          <span>{{ label() }}</span>
          @if (tooltipText()) {
            <app-tooltip [content]="tooltipText()!" position="top">
              <span class="help-icon">
                <app-icon name="help-circle" [size]="14"></app-icon>
              </span>
            </app-tooltip>
          }
          @if (required()) {
            <span
              class="text-[var(--color-destructive)] ml-0.5"
              >*</span
              >
            }
          </label>
        }

        @if (searchable()) {
          <!-- Searchable mode: custom dropdown with filter input.
               Opt-in via [searchable]="true"; default keeps the native <select>. -->
          <div [class]="wrapperClasses">
            <button
              type="button"
              [id]="id()"
              [class]="selectClasses + ' text-left flex items-center'"
              [disabled]="isDisabled()"
              (click)="toggleDropdown()"
              (blur)="onBlur()"
              >
              <span
                class="flex-1 truncate"
                [style.color]="selectedValue() == null ? 'var(--color-text-secondary)' : 'var(--color-text-primary)'"
                >
                {{ selectedLabel() || placeholder() }}
              </span>
            </button>

            <div [class]="iconClasses">
              <app-icon [name]="isOpen() ? 'chevron-up' : 'chevron-down'" [size]="iconSize"></app-icon>
            </div>

            @if (isOpen()) {
              <div
                class="absolute z-[10000] w-full bg-[var(--color-surface)] border border-border shadow-lg max-h-60 overflow-auto rounded-xl"
                [class.mt-1]="!dropUp()"
                [class.mb-1]="dropUp()"
                [class.top-full]="!dropUp()"
                [class.bottom-full]="dropUp()"
                >
                <div class="p-2 border-b border-border sticky top-0 bg-[var(--color-surface)]">
                  <input
                    #searchInput
                    type="text"
                    [ngModel]="searchTerm()"
                    (ngModelChange)="onSearch($event)"
                    class="w-full px-3 py-1.5 text-sm border border-border rounded-lg
                           hover:border-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-ring)] focus:border-[var(--color-primary)]
                           bg-[var(--color-surface)] text-[var(--color-text-primary)]"
                    placeholder="Buscar..."
                    />
                </div>
                <div class="py-1">
                  @for (option of filteredOptions(); track trackByOption($index, option)) {
                    <button
                      type="button"
                      [disabled]="option.disabled"
                      (click)="selectOption(option)"
                      class="w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors
                             hover:bg-primary-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      [class.bg-primary-50]="option.value == selectedValue()"
                      [class.font-semibold]="option.value == selectedValue()"
                      >
                      <!-- Optional leading thumbnail/avatar. Only rendered when the
                           option provides an imageUrl or an icon, so options that use
                           neither look exactly as before (full backward compat). -->
                      @if (option.imageUrl || option.icon) {
                        @if (option.imageUrl && !hasImageFailed(option.imageUrl)) {
                          <img
                            [src]="option.imageUrl"
                            [alt]="option.label"
                            (error)="onImageError(option.imageUrl!)"
                            class="w-7 h-7 rounded-md object-cover shrink-0 bg-[var(--color-surface-muted)]"
                            />
                        } @else if (option.icon) {
                          <span
                            class="w-7 h-7 rounded-md shrink-0 flex items-center justify-center bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)]"
                            >
                            <app-icon [name]="$any(option.icon)" [size]="16"></app-icon>
                          </span>
                        } @else {
                          <span
                            class="w-7 h-7 rounded-md shrink-0 flex items-center justify-center bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)]"
                            >
                            <app-icon name="image" [size]="16"></app-icon>
                          </span>
                        }
                      }
                      <span
                        class="flex-1 min-w-0 text-[var(--color-text-primary)] truncate"
                        [class.text-primary-700]="option.value == selectedValue()"
                        >{{ option.label }}</span>
                      @if (option.description) {
                        <span
                          class="text-xs text-[var(--color-text-secondary)] truncate whitespace-nowrap overflow-hidden max-w-[40%] shrink-0"
                          [title]="option.description"
                          >
                          {{ option.description }}
                        </span>
                      }
                    </button>
                  }
                  @if (filteredOptions().length === 0) {
                    <div class="px-3 py-4 text-center text-sm text-[var(--color-text-secondary)]">
                      No se encontraron opciones
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        } @else {
          <div [class]="wrapperClasses">
            <select
              [id]="id()"
              [class]="selectClasses"
              [disabled]="isDisabled()"
              [required]="required()"
              [ngModel]="selectedValue()"
              (ngModelChange)="onModelChange($event)"
              (blur)="onBlur()"
              (focus)="onFocus()"
              >
              @if (placeholder()) {
                <option [ngValue]="null" disabled selected class="text-text-muted">
                  {{ placeholder() }}
                </option>
              }
              @for (option of options(); track trackByOption($index, option)) {
                <option
                  [ngValue]="option.value"
                  [disabled]="option.disabled"
                  >
                  {{ option.label }}
                </option>
              }
            </select>

            <div [class]="iconClasses">
              <app-icon name="chevron-down" [size]="iconSize"></app-icon>
            </div>
          </div>
        }

        @if (helpText() || errorText()) {
          <div class="mt-1 text-sm">
            @if (helpText() && !errorText()) {
              <span class="text-[var(--color-text-secondary)]">
                {{ helpText() }}
              </span>
            }
            @if (errorText()) {
              <span class="text-[var(--color-destructive)] flex items-center gap-1 font-medium">
                <app-icon name="alert-circle" [size]="12"></app-icon>
                {{ errorText() }}
              </span>
            }
          </div>
        }
      </div>
    `,
  styleUrls: ['./selector.component.scss'],
})
export class SelectorComponent implements ControlValueAccessor {
  private readonly elementRef = inject(ElementRef);

  /**
   * Referencia al input de búsqueda del modo searchable. Existe solo cuando
   * `@if (isOpen())` lo renderiza, por eso es una query signal: se resuelve
   * post-render y dispara el effect de autofocus.
   */
  private readonly searchInput =
    viewChild<ElementRef<HTMLInputElement>>('searchInput');

  constructor() {
    // Al abrir el dropdown searchable, enfocar el input de búsqueda para que el
    // usuario pueda teclear de inmediato (UX: no exigir un click extra). El
    // effect re-corre cuando isOpen() o la query signal cambian; en zoneless la
    // escritura del signal agenda el render y la query se resuelve antes de esta
    // pasada del effect.
    effect(() => {
      if (this.isOpen() && this.searchable()) {
        this.searchInput()?.nativeElement.focus();
      }
    });
  }

  readonly id = input<string>(`selector-${Math.random().toString(36).substr(2, 9)}`);
  readonly label = input<string>('');
  readonly placeholder = input<string>('');
  readonly helpText = input<string>('');
  readonly errorText = input<string>('');
  readonly required = input<boolean>(false);
  readonly disabled = input<boolean>(false);
  readonly disabledState = signal(false);
  readonly size = input<SelectorSize>('md');
  readonly variant = input<SelectorVariant>('default');
  readonly styleVariant = input<FormStyleVariant>('modern');
  readonly options = input<SelectorOption[]>([]);
  readonly tooltipText = input<string | undefined>(undefined);
  /** When true, renders a custom dropdown with a search filter instead of the
   *  native <select>. Default false keeps the existing native behaviour, so no
   *  existing usage changes unless it opts in. */
  readonly searchable = input<boolean>(false);

  readonly valueChange = output<string | number | null>();
  readonly blur = output<void>();
  readonly focus = output<void>();

  readonly selectedValue = signal<string | number | null>(null);

  // --- Searchable mode state ---
  readonly isOpen = signal<boolean>(false);
  readonly searchTerm = signal<string>('');
  /**
   * When true the panel opens ABOVE the trigger (drop-up) so it is not
   * clipped by the viewport. Default false keeps the historic below
   * behaviour; the open handler recomputes the direction by measuring
   * the available space, mirroring the `resolvePosition` pattern in
   * `tooltip.component.ts`.
   */
  readonly dropUp = signal<boolean>(false);

  /**
   * URLs de miniaturas que fallaron al cargar. Se registran vía `onImageError`
   * para caer al placeholder/icono sin romper el layout. Es un signal para que
   * el template reaccione en zoneless (la escritura agenda la detección).
   */
  private readonly failedImageUrls = signal<Set<string>>(new Set<string>());

  /** Estimated panel height used to decide whether to flip. Matches
   *  the visual `max-h-60` (~240px) plus the search-input row. */
  private readonly panelEstimatedHeight = 260;

  readonly filteredOptions = computed<SelectorOption[]>(() => {
    const term = this.searchTerm().toLowerCase().trim();
    if (!term) return this.options();
    return this.options().filter(
      (o) =>
        o.label.toLowerCase().includes(term) ||
        (o.description?.toLowerCase().includes(term) ?? false),
    );
  });

  readonly selectedLabel = computed<string>(() => {
    const value = this.selectedValue();
    if (value == null) return '';
    const found = this.options().find((o) => o.value == value);
    return found?.label ?? '';
  });

  // ControlValueAccessor callbacks
  private onChange: (value: string | number | null) => void = () => { };
  private onTouched: () => void = () => { };

  // ControlValueAccessor implementation
  writeValue(value: string | number | null): void {
    this.selectedValue.set(value);
  }

  registerOnChange(fn: (value: string | number | null) => void): void {
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

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.isOpen()) return;
    const path = event.composedPath();
    const isInside = path.some((node) => node === this.elementRef.nativeElement);
    if (!isInside) {
      this.isOpen.set(false);
    }
  }

  onModelChange(value: string | number | null): void {
    this.selectedValue.set(value);
    this.onChange(value);
    this.valueChange.emit(value);
  }

  toggleDropdown(): void {
    if (this.isDisabled()) return;
    if (!this.isOpen()) {
      this.searchTerm.set('');
      this.dropUp.set(this.shouldOpenUpward());
    }
    this.isOpen.update((v) => !v);
  }

  /**
   * Returns true if there is not enough space below the trigger to render
   * the dropdown panel and more space is available above. Measures the
   * trigger rect against the viewport, mirroring how `tooltip.component.ts`
   * flips out-of-bounds tooltips.
   */
  private shouldOpenUpward(): boolean {
    const hostEl = this.elementRef.nativeElement as HTMLElement | undefined;
    if (!hostEl) return false;
    const rect = hostEl.getBoundingClientRect();
    const viewportHeight =
      typeof window !== 'undefined' ? window.innerHeight : 0;
    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;
    return (
      spaceBelow < this.panelEstimatedHeight && spaceAbove > spaceBelow
    );
  }

  selectOption(option: SelectorOption): void {
    if (option.disabled) return;
    this.selectedValue.set(option.value);
    this.onChange(option.value);
    this.valueChange.emit(option.value);
    this.onTouched();
    this.isOpen.set(false);
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
  }

  /** Marca una URL de miniatura como fallida para caer al fallback. */
  onImageError(url: string): void {
    this.failedImageUrls.update((set) => {
      if (set.has(url)) return set;
      const next = new Set(set);
      next.add(url);
      return next;
    });
  }

  /** true si la miniatura de esa URL ya falló al cargar. */
  hasImageFailed(url: string | undefined): boolean {
    return url != null && this.failedImageUrls().has(url);
  }

  onFocus(): void {
    this.focus.emit();
  }

  onBlur(): void {
    this.onTouched();
    this.blur.emit();
  }

  trackByOption(index: number, option: SelectorOption): string | number {
    return option.value;
  }

  // CSS classes
  get containerClasses(): string {
    return ['w-full'].filter(Boolean).join(' ');
  }

  get labelClasses(): string {
    const baseClasses = ['block', 'font-medium', 'mb-2'];

    if (this.styleVariant() === 'modern') {
      return [
        ...baseClasses,
        'text-[11px]',
        'uppercase',
        'tracking-[0.05em]',
        'text-[var(--color-text-muted)]',
        this.isDisabled() ? 'opacity-50 cursor-not-allowed' : '',
      ]
        .filter(Boolean)
        .join(' ');
    }

    return [
      ...baseClasses,
      'text-sm',
      'text-[var(--color-text-primary)]',
      this.isDisabled() ? 'opacity-50 cursor-not-allowed' : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  get wrapperClasses(): string {
    return ['relative'].filter(Boolean).join(' ');
  }

  get selectClasses(): string {
    const baseClasses = [
      'appearance-none',
      'block',
      'w-full',
      'border',
      'truncate',
      'transition-colors',
      'duration-200',
      'focus:outline-none',
      'bg-[var(--color-surface)]',
      'text-[var(--color-text-primary)]',
    ];

    let stateClasses: string[];
    if (this.errorText()) {
      stateClasses = [
        'border',
        'border-[var(--color-destructive)]',
        'focus:border-[var(--color-destructive)]',
        'bg-[rgba(239,68,68,0.1)]',
      ];
    } else {
      stateClasses = [
        'border',
        'border-border',
        'hover:border-[var(--color-primary)]',
        'focus:border-[var(--color-primary)]',
      ];
    }

    let variantClasses: string[];

    // Unified height system (matches ButtonComponent & InputComponent)
    // sm: 32px mobile → 36px desktop
    // md: 40px mobile → 44px desktop
    // lg: 48px mobile → 52px desktop
    const sizeClasses = {
      sm: ['h-8', 'sm:h-9', 'pl-3', 'pr-10', 'text-sm'],
      md: ['h-10', 'sm:h-11', 'pl-3', 'sm:pl-4', 'pr-10', 'text-sm', 'sm:text-base'],
      lg: ['h-12', 'sm:h-[52px]', 'pl-4', 'pr-10', 'text-base', 'sm:text-lg'],
    };

    if (this.styleVariant() === 'modern') {
      // Modern: iOS-inspired with shadow focus
      variantClasses = [
        ...sizeClasses[this.size()],
        'rounded-xl',
        '!bg-[var(--color-background)]',
        'focus:!bg-[var(--color-surface)]',
        this.errorText()
          ? 'focus:shadow-[0_0_0_2px_rgba(239,68,68,0.3)]'
          : 'focus:shadow-[0_0_0_2px_var(--color-ring)]',
      ];
    } else {
      // Classic: with ring focus
      variantClasses = [
        ...sizeClasses[this.size()],
        'rounded-xl',
        'focus:ring-2',
        this.errorText()
          ? 'focus:ring-[var(--color-destructive)]/30'
          : 'focus:ring-[var(--color-ring)]',
      ];
    }

    return [
      ...baseClasses,
      ...variantClasses,
      ...stateClasses,
      this.variant() && this.variant() !== 'default' ? `selector-${this.variant()}` : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  get iconClasses(): string {
    return ['absolute', 'right-3', 'top-1/2', '-translate-y-1/2', 'pointer-events-none', 'text-[var(--color-text-secondary)]'].filter(Boolean).join(' ');
  }

  get placeholderClasses(): string {
    return [
      'selector-placeholder',
      this.size() && `selector-placeholder-${this.size()}`,
      this.isDisabled() ? 'selector-placeholder-disabled' : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  get iconSize(): number {
    switch (this.size()) {
      case 'sm':
        return 14;
      case 'lg':
        return 20;
      default:
        return 16;
    }
  }
}
