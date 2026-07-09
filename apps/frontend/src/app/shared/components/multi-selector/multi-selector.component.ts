import {
  Component,
  DestroyRef,
  ElementRef,
  forwardRef,
  inject,
  OnDestroy,
  output,
  signal,
  TemplateRef,
  ViewContainerRef,
  viewChild,
  computed,
  input,
} from '@angular/core';

import {
  ControlValueAccessor,
  FormsModule,
  NG_VALUE_ACCESSOR,
  ReactiveFormsModule,
} from '@angular/forms';
import {
  ConnectedPosition,
  Overlay,
  OverlayRef,
} from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { ESCAPE } from '@angular/cdk/keycodes';
import { fromEvent } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IconComponent } from '../icon/icon.component';
import { TooltipComponent } from '../tooltip/tooltip.component';
import { FormStyleVariant } from '../../types/form.types';

export interface MultiSelectorOption {
  value: string | number;
  label: string;
  disabled?: boolean;
  description?: string;
  icon?: string;
}

export type MultiSelectorSize = 'sm' | 'md' | 'lg';

@Component({
  selector: 'app-multi-selector',
  standalone: true,
  imports: [FormsModule, ReactiveFormsModule, IconComponent, TooltipComponent],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => MultiSelectorComponent),
      multi: true,
    },
  ],
  template: `
    <div class="w-full">
      @if (label()) {
        <label
          [class]="labelClasses"
          class="label-with-tooltip"
          [class.opacity-50]="disabled()"
          >
          <span>{{ label() }}</span>
          @if (tooltipText()) {
            <app-tooltip [content]="tooltipText()" position="top">
              <span class="help-icon">
                <app-icon name="help-circle" [size]="14"></app-icon>
              </span>
            </app-tooltip>
          }
          @if (required()) {
            <span class="text-[var(--color-destructive)] ml-0.5">*</span>
          }
        </label>
      }

      <div class="relative">
        <!-- Trigger Button -->
        <button
          #trigger
          type="button"
          [disabled]="disabled()"
          (click)="toggleDropdown()"
          [class]="triggerClasses"
          [class.border-border]="!errorText()"
          [class.border-destructive]="errorText()"
          >
          <div class="flex flex-wrap gap-1.5 items-center pr-6">
            <!-- Selected chips -->
            @for (value of selectedValues(); track value) {
              <span
              class="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium
                     bg-primary-50 text-primary-600 border border-primary-200"
                style="border-radius: var(--radius-sm);"
                >
                {{ getOptionLabel(value) }}
                <button
                  type="button"
                  (click)="removeValue(value, $event)"
                  class="hover:text-primary-800 transition-colors"
                  >
                  <app-icon name="x" [size]="12"></app-icon>
                </button>
              </span>
            }

            <!-- Placeholder -->
            @if (selectedValues().length === 0) {
              <span
                class="text-[var(--color-text-secondary)]"
                >
                {{ placeholder() }}
              </span>
            }
          </div>

          <!-- Chevron -->
          <div class="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--color-text-secondary)]">
            <app-icon [name]="isOpen() ? 'chevron-up' : 'chevron-down'" [size]="16"></app-icon>
          </div>
        </button>
      </div>

      <!-- Help/Error text -->
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

    <!-- Dropdown menu portal (lives outside Angular view encapsulation via CDK overlay) -->
    <ng-template #menuTpl>
      <div class="multi-selector-menu">
        <!-- Search input -->
        <div class="multi-selector-menu__search">
          <input
            type="text"
            [ngModel]="searchTerm()"
            (ngModelChange)="onSearch($event)"
            class="multi-selector-menu__search-input"
            placeholder="Buscar..."
            autocomplete="off"
          />
        </div>
        <!-- Options -->
        <div class="multi-selector-menu__options">
          @for (option of filteredOptions(); track option.value) {
            <button
              type="button"
              [disabled]="option.disabled"
              (click)="toggleOption(option)"
              class="multi-selector-menu__option"
              [class.multi-selector-menu__option--selected]="isSelected(option.value)"
              >
              <div
                class="multi-selector-menu__option-checkbox"
                [class.multi-selector-menu__option-checkbox--checked]="isSelected(option.value)"
                >
                @if (isSelected(option.value)) {
                  <app-icon name="check" [size]="12" class="text-white"></app-icon>
                }
              </div>
              <span
                class="multi-selector-menu__option-label"
                [class.text-primary-700]="isSelected(option.value)"
              >{{ option.label }}</span>
              @if (option.description) {
                <span
                  class="multi-selector-menu__option-description"
                  [title]="option.description"
                >
                  {{ option.description }}
                </span>
              }
            </button>
          }
          @if (filteredOptions().length === 0) {
            <div class="multi-selector-menu__empty">
              No se encontraron opciones
            </div>
          }
        </div>
      </div>
    </ng-template>
    `,
  styles: [`
    :host {
      display: block;
    }

    .label-with-tooltip {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }

    .help-icon {
      color: var(--color-text-muted);
      cursor: help;
      position: relative;
      display: inline-flex;
      transition: color 0.2s ease;
    }

    .help-icon:hover {
      color: var(--color-primary);
    }
  `],
})
export class MultiSelectorComponent implements ControlValueAccessor, OnDestroy {
  readonly label = input<string>('');
  readonly placeholder = input<string>('Seleccionar...');
  readonly helpText = input<string>('');
  readonly tooltipText = input<string>('');
  readonly errorText = input<string>('');
  readonly required = input<boolean>(false);
  readonly disabled = input<boolean>(false);
  readonly size = input<MultiSelectorSize>('md');
  readonly styleVariant = input<FormStyleVariant>('modern');
  readonly options = input<MultiSelectorOption[]>([]);

  readonly valueChange = output<(string | number)[]>();

  readonly selectedValues = signal<(string | number)[]>([]);
  readonly isOpen = signal<boolean>(false);
  readonly searchTerm = signal<string>('');

  readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  readonly menuTpl = viewChild<TemplateRef<unknown>>('menuTpl');

  readonly filteredOptions = computed(() => {
    const term = this.searchTerm().toLowerCase();
    if (!term) return this.options();
    return this.options().filter(
      (o) =>
        o.label.toLowerCase().includes(term) ||
        (o.description && o.description.toLowerCase().includes(term)),
    );
  });

  private readonly overlay = inject(Overlay);
  private readonly vcr = inject(ViewContainerRef);
  private readonly destroyRef = inject(DestroyRef);
  private overlayRef: OverlayRef | null = null;

  private onChange: (value: (string | number)[]) => void = () => {};
  private onTouched: () => void = () => {};

  // ControlValueAccessor
  writeValue(value: (string | number)[] | null): void {
    this.selectedValues.set(value || []);
  }

  registerOnChange(fn: (value: (string | number)[]) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(_isDisabled: boolean): void {
    // disabled is managed via input() signal — no action needed
  }

  // UI Methods
  toggleDropdown(): void {
    if (this.disabled()) return;
    if (this.isOpen()) {
      this.close();
    } else {
      this.searchTerm.set('');
      this.open();
    }
  }

  toggleOption(option: MultiSelectorOption): void {
    if (option.disabled) return;

    const current = this.selectedValues();
    const index = current.findIndex((v) => v == option.value);
    if (index === -1) {
      this.selectedValues.set([...current, option.value]);
    } else {
      this.selectedValues.set(current.filter((v) => v != option.value));
    }

    this.emitChange();
  }

  removeValue(value: string | number, event: MouseEvent): void {
    event.stopPropagation();
    this.selectedValues.update((current) => current.filter((v) => v != value));
    this.emitChange();
  }

  isSelected(value: string | number): boolean {
    return this.selectedValues().some((v) => v == value);
  }

  getOptionLabel(value: string | number): string {
    const option = this.options().find((o) => o.value === value);
    return option?.label || String(value);
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
  }

  private open(): void {
    const btn = this.trigger()?.nativeElement;
    const tpl = this.menuTpl();
    if (!btn || !tpl) return;

    const positions: ConnectedPosition[] = [
      // Preferred: below the trigger, aligned to start
      { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 4 },
      // Fallback above: trigger top → menu bottom
      { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -4 },
    ];

    const positionStrategy = this.overlay
      .position()
      .flexibleConnectedTo(btn)
      .withPositions(positions)
      .withPush(true)
      .withFlexibleDimensions(false)
      .withViewportMargin(8);

    // Match panel width to trigger width so layout matches the inline behavior
    const triggerWidth = btn.offsetWidth;

    this.overlayRef = this.overlay.create({
      positionStrategy,
      scrollStrategy: this.overlay.scrollStrategies.reposition(),
      hasBackdrop: true,
      backdropClass: 'cdk-overlay-transparent-backdrop',
      panelClass: 'multi-selector-panel',
      width: triggerWidth,
      maxHeight: 240,
    });

    this.overlayRef.attach(new TemplatePortal(tpl, this.vcr));
    this.isOpen.set(true);

    this.overlayRef
      .backdropClick()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.close());

    this.overlayRef
      .keydownEvents()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((ev) => {
        if (ev.keyCode === ESCAPE) this.close();
      });

    fromEvent(window, 'resize')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.close());
  }

  private close(): void {
    this.overlayRef?.detach();
    this.overlayRef?.dispose();
    this.overlayRef = null;
    this.isOpen.set(false);
  }

  ngOnDestroy(): void {
    this.close();
  }

  private emitChange(): void {
    const current = this.selectedValues();
    this.onChange(current);
    this.onTouched();
    this.valueChange.emit(current);
  }

  // CSS class getters
  get labelClasses(): string {
    const baseClasses = ['block', 'font-medium', 'mb-2'];

    if (this.styleVariant() === 'modern') {
      return [
        ...baseClasses,
        'text-[11px]',
        'uppercase',
        'tracking-[0.05em]',
        'text-[var(--color-text-muted)]',
      ].join(' ');
    }

    return [
      ...baseClasses,
      'text-sm',
      'text-[var(--color-text-primary)]',
    ].join(' ');
  }

  get triggerClasses(): string {
    const baseClasses = [
      'w-full',
      'px-3',
      'py-2',
      'text-left',
      'border',
      'bg-[var(--color-surface)]',
      'transition-colors',
      'hover:border-[var(--color-primary)]',
      'focus:border-[var(--color-primary)]',
      'focus:outline-none',
      'disabled:opacity-50',
      'disabled:cursor-not-allowed',
    ];

    // Unified height system (matches Button, Input, Selector)
    const sizeClasses = {
      sm: ['min-h-8', 'sm:min-h-9'],
      md: ['min-h-10', 'sm:min-h-11'],
      lg: ['min-h-12', 'sm:min-h-[52px]'],
    };

    if (this.styleVariant() === 'modern') {
      return [
        ...baseClasses,
        ...sizeClasses[this.size()],
        'rounded-xl',
        '!bg-[var(--color-background)]',
        'focus:!bg-[var(--color-surface)]',
        'focus:shadow-[0_0_0_2px_var(--color-ring)]',
      ].join(' ');
    }

    return [
      ...baseClasses,
      ...sizeClasses[this.size()],
      'rounded-xl',
      'focus:ring-2',
      'focus:ring-[var(--color-ring)]',
      'focus:border-[var(--color-primary)]',
    ].join(' ');
  }
}
