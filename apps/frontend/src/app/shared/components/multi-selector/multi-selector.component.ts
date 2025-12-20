import {
  Component,
  Input,
  Output,
  EventEmitter,
  forwardRef,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
  HostListener,
  ElementRef,
  ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ControlValueAccessor,
  NG_VALUE_ACCESSOR,
  FormsModule,
  ReactiveFormsModule,
} from '@angular/forms';
import { Subject } from 'rxjs';
import { IconComponent } from '../icon/icon.component';

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
  imports: [CommonModule, FormsModule, ReactiveFormsModule, IconComponent],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => MultiSelectorComponent),
      multi: true,
    },
  ],
  template: `
    <div class="w-full">
      <label
        *ngIf="label"
        class="block text-sm font-medium text-[var(--color-text-primary)] mb-2"
        [class.opacity-50]="disabled"
      >
        {{ label }}
        <span *ngIf="required" class="text-[var(--color-destructive)] ml-0.5">*</span>
      </label>

      <div class="relative">
        <!-- Trigger Button -->
        <button
          type="button"
          [disabled]="disabled"
          (click)="toggleDropdown()"
          class="w-full min-h-[42px] px-3 py-2 text-left border rounded-lg bg-[var(--color-surface)] transition-colors
                 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary
                 disabled:opacity-50 disabled:cursor-not-allowed"
          [class.border-border]="!errorText"
          [class.border-destructive]="errorText"
        >
          <div class="flex flex-wrap gap-1.5 items-center">
            <!-- Selected chips -->
            <span
              *ngFor="let value of selectedValues"
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium
                     bg-primary-50 text-primary-600 border border-primary-200"
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
            
            <!-- Placeholder -->
            <span
              *ngIf="selectedValues.length === 0"
              class="text-[var(--color-text-secondary)]"
            >
              {{ placeholder }}
            </span>
          </div>
          
          <!-- Chevron -->
          <div class="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-[var(--color-text-secondary)]">
            <app-icon [name]="isOpen ? 'chevron-up' : 'chevron-down'" [size]="16"></app-icon>
          </div>
        </button>

        <!-- Dropdown -->
        <div
          *ngIf="isOpen"
          class="absolute z-50 w-full mt-1 bg-[var(--color-surface)] border border-border rounded-lg shadow-lg max-h-60 overflow-auto"
        >
          <!-- Search input -->
          <div class="p-2 border-b border-border sticky top-0 bg-[var(--color-surface)]">
            <input
              type="text"
              [(ngModel)]="searchTerm"
              (input)="onSearch()"
              class="w-full px-3 py-1.5 text-sm border border-border rounded-md
                     focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary
                     bg-[var(--color-surface)] text-[var(--color-text-primary)]"
              placeholder="Buscar..."
            />
          </div>

          <!-- Options -->
          <div class="py-1">
            <button
              *ngFor="let option of filteredOptions"
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
                class="w-4 h-4 rounded border flex items-center justify-center transition-colors shadow-sm"
                [class.border-primary-600]="isSelected(option.value)"
                [class.bg-primary-600]="isSelected(option.value)"
                [class.border-gray-300]="!isSelected(option.value)"
              >
                <app-icon
                  *ngIf="isSelected(option.value)"
                  name="check"
                  [size]="12"
                  class="text-white"
                ></app-icon>
              </div>
              
              <span class="flex-1 text-[var(--color-text-primary)]" [class.text-primary-700]="isSelected(option.value)">{{ option.label }}</span>
              
              <span *ngIf="option.description" class="text-xs text-[var(--color-text-secondary)]">
                {{ option.description }}
              </span>
            </button>

            <div
              *ngIf="filteredOptions.length === 0"
              class="px-3 py-4 text-center text-sm text-[var(--color-text-secondary)]"
            >
              No se encontraron opciones
            </div>
          </div>
        </div>
      </div>

      <!-- Help/Error text -->
      <div *ngIf="helpText || errorText" class="mt-1 text-sm">
        <span *ngIf="helpText && !errorText" class="text-[var(--color-text-secondary)]">
          {{ helpText }}
        </span>
        <span *ngIf="errorText" class="text-[var(--color-destructive)] flex items-center gap-1 font-medium">
          <app-icon name="alert-circle" [size]="12"></app-icon>
          {{ errorText }}
        </span>
      </div>
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
  @Input() placeholder = 'Seleccionar...';
  @Input() helpText = '';
  @Input() errorText = '';
  @Input() required = false;
  @Input() disabled = false;
  @Input() size: MultiSelectorSize = 'md';
  @Input() options: MultiSelectorOption[] = [];

  @Output() valueChange = new EventEmitter<(string | number)[]>();

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
    this.filteredOptions = [...this.options];
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
      this.filteredOptions = [...this.options];
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
    const option = this.options.find(o => o.value === value);
    return option?.label || String(value);
  }

  onSearch(): void {
    const term = this.searchTerm.toLowerCase();
    this.filteredOptions = this.options.filter(
      o => o.label.toLowerCase().includes(term) ||
        (o.description && o.description.toLowerCase().includes(term))
    );
  }

  private emitChange(): void {
    this.onChange(this.selectedValues);
    this.onTouched();
    this.valueChange.emit(this.selectedValues);
  }
}
