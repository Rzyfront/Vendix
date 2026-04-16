import {
  Component,
  Input,
  forwardRef,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
  HostListener,
  ElementRef,
  ChangeDetectorRef,
  input,
  output
} from '@angular/core';

import {
  ControlValueAccessor,
  NG_VALUE_ACCESSOR,
  FormsModule,
  ReactiveFormsModule,
} from '@angular/forms';
import { Subject } from 'rxjs';
import { IconComponent } from '../icon/icon.component';
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
  imports: [FormsModule, ReactiveFormsModule, IconComponent],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => MultiSelectorComponent),
      multi: true,
    },
  ],
  template: `
    <div class="w-full">
      @if (label) {
        <label
          [class]="labelClasses"
          [class.opacity-50]="disabled"
          >
          {{ label }}
          @if (required()) {
            <span class="text-[var(--color-destructive)] ml-0.5">*</span>
          }
        </label>
      }
    
      <div class="relative">
        <!-- Trigger Button -->
        <button
          type="button"
          [disabled]="disabled"
          (click)="toggleDropdown()"
          [class]="triggerClasses"
          [class.border-border]="!errorText"
          [class.border-destructive]="errorText"
          >
          <div class="flex flex-wrap gap-1.5 items-center">
            <!-- Selected chips -->
            @for (value of selectedValues; track value) {
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
            @if (selectedValues.length === 0) {
              <span
                class="text-[var(--color-text-secondary)]"
                >
              {{ placeholder() }}
              </span>
            }
          </div>
    
          <!-- Chevron -->
          <div class="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--color-text-secondary)]">
            <app-icon [name]="isOpen ? 'chevron-up' : 'chevron-down'" [size]="16"></app-icon>
          </div>
        </button>
    
        <!-- Dropdown -->
        @if (isOpen) {
          <div
            class="absolute z-50 w-full mt-1 bg-[var(--color-surface)] border border-border shadow-lg max-h-60 overflow-auto"
            style="border-radius: var(--radius-sm);"
            >
            <!-- Search input -->
            <div class="p-2 border-b border-border sticky top-0 bg-[var(--color-surface)]">
              <input
                type="text"
                [(ngModel)]="searchTerm"
                (input)="onSearch()"
              class="w-full px-3 py-1.5 text-sm border border-border
                     focus:outline-none focus:ring-1 focus:ring-secondary/40 focus:border-primary
                     bg-[var(--color-surface)] text-[var(--color-text-primary)]"
                style="border-radius: var(--radius-sm);"
                placeholder="Buscar..."
                />
            </div>
            <!-- Options -->
            <div class="py-1">
              @for (option of filteredOptions; track option) {
                <button
                  type="button"
                  [disabled]="option.disabled"
                  (click)="toggleOption(option)"
              class="w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors
                     hover:bg-[var(--color-surface-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
                  [class.bg-primary-50]="isSelected(option.value)"
                  [class.font-semibold]="isSelected(option.value)"
                  >
                  <!-- Checkbox indicator -->
                  <div
                    class="w-4 h-4 border flex items-center justify-center transition-colors shadow-sm"
                    [class.border-primary-600]="isSelected(option.value)"
                    [class.bg-primary-600]="isSelected(option.value)"
                    [class.border-gray-300]="!isSelected(option.value)"
                    style="border-radius: var(--radius-sm);"
                    >
                    @if (isSelected(option.value)) {
                      <app-icon
                        name="check"
                        [size]="12"
                        class="text-white"
                      ></app-icon>
                    }
                  </div>
                  <span class="flex-1 text-[var(--color-text-primary)]" [class.text-primary-700]="isSelected(option.value)">{{ option.label }}</span>
                  @if (option.description) {
                    <span class="text-xs text-[var(--color-text-secondary)]">
                      {{ option.description }}
                    </span>
                  }
                </button>
              }
              @if (filteredOptions.length === 0) {
                <div
                  class="px-3 py-4 text-center text-sm text-[var(--color-text-secondary)]"
                  >
                  No se encontraron opciones
                </div>
              }
            </div>
          </div>
        }
      </div>
    
      <!-- Help/Error text -->
      @if (helpText || errorText) {
        <div class="mt-1 text-sm">
          @if (helpText && !errorText) {
            <span class="text-[var(--color-text-secondary)]">
              {{ helpText }}
            </span>
          }
          @if (errorText) {
            <span class="text-[var(--color-destructive)] flex items-center gap-1 font-medium">
              <app-icon name="alert-circle" [size]="12"></app-icon>
              {{ errorText }}
            </span>
          }
        </div>
      }
    </div>
    `,
  styles: [`
    :host {
      display: block;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MultiSelectorComponent implements ControlValueAccessor, OnInit, OnDestroy {
  @Input() label = '';
  readonly placeholder = input('Seleccionar...');
  @Input() helpText = '';
  @Input() errorText = '';
  readonly required = input(false);
  @Input() disabled = false;
  readonly size = input<MultiSelectorSize>('md');
  readonly styleVariant = input<FormStyleVariant>('modern');
  readonly options = input<MultiSelectorOption[]>([]);

  readonly valueChange = output<(string | number)[]>();

  selectedValues: (string | number)[] = [];
  isOpen = false;
  searchTerm = '';
  filteredOptions: MultiSelectorOption[] = [];

  private destroy$ = new Subject<void>();
  private onChange: (value: (string | number)[]) => void = () => { };
  private onTouched: () => void = () => { };

  constructor(
    private elementRef: ElementRef,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    this.filteredOptions = [...this.options()];
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.elementRef.nativeElement.contains(event.target)) {
      this.isOpen = false;
    }
  }

  // ControlValueAccessor
  writeValue(value: (string | number)[] | null): void {
    this.selectedValues = value || [];
    this.cdr.markForCheck();
  }

  registerOnChange(fn: (value: (string | number)[]) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  // UI Methods
  toggleDropdown(): void {
    if (this.disabled) return;
    this.isOpen = !this.isOpen;
    if (this.isOpen) {
      this.searchTerm = '';
      this.filteredOptions = [...this.options()];
    }
  }

  toggleOption(option: MultiSelectorOption): void {
    if (option.disabled) return;

    const index = this.selectedValues.findIndex(v => v == option.value);
    if (index === -1) {
      this.selectedValues = [...this.selectedValues, option.value];
    } else {
      this.selectedValues = this.selectedValues.filter(v => v != option.value);
    }

    this.emitChange();
    this.cdr.markForCheck();
  }

  removeValue(value: string | number, event: MouseEvent): void {
    event.stopPropagation();
    this.selectedValues = this.selectedValues.filter(v => v != value);
    this.emitChange();
    this.cdr.markForCheck();
  }

  isSelected(value: string | number): boolean {
    return this.selectedValues.some(v => v == value);
  }

  getOptionLabel(value: string | number): string {
    const option = this.options().find(o => o.value === value);
    return option?.label || String(value);
  }

  onSearch(): void {
    const term = this.searchTerm.toLowerCase();
    this.filteredOptions = this.options().filter(
      o => o.label.toLowerCase().includes(term) ||
        (o.description && o.description.toLowerCase().includes(term))
    );
  }

  private emitChange(): void {
    this.onChange(this.selectedValues);
    this.onTouched();
    this.valueChange.emit(this.selectedValues);
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
      'focus:outline-none',
      'disabled:opacity-50',
      'disabled:cursor-not-allowed',
    ];

    // Unified height system (matches Button, Input, Selector)
    // sm: 32px mobile → 36px desktop
    // md: 40px mobile → 44px desktop
    // lg: 48px mobile → 52px desktop
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
        'focus:shadow-[0_0_0_3px_var(--color-ring)]',
      ].join(' ');
    }

    // Classic: with ring focus
    return [
      ...baseClasses,
      ...sizeClasses[this.size()],
      'rounded-xl',
      'focus:ring-2',
      'focus:ring-secondary/40',
      'focus:border-primary',
    ].join(' ');
  }
}
