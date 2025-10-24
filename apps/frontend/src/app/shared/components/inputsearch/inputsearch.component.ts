import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, forwardRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ControlValueAccessor, NG_VALUE_ACCESSOR, ReactiveFormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';

export type InputSearchSize = 'sm' | 'md' | 'lg';

@Component({
  selector: 'app-inputsearch',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => InputsearchComponent),
      multi: true
    }
  ],
  styleUrl: './inputsearch.component.scss',
  template: `
    <div class="inputsearch-container" [class]="containerClasses">
      <div class="inputsearch-wrapper" [class]="wrapperClasses">
        <!-- Icono de lupa -->
        <div class="inputsearch-icon" [class]="iconClasses">
          <svg 
            class="search-icon" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            stroke-width="2" 
            stroke-linecap="round" 
            stroke-linejoin="round"
          >
            <circle cx="11" cy="11" r="8"></circle>
            <path d="m21 21-4.35-4.35"></path>
          </svg>
        </div>
        
        <!-- Input de búsqueda -->
        <input
          [type]="type"
          [placeholder]="placeholder"
          [disabled]="disabled"
          [readonly]="readonly"
          [value]="value"
          [class]="inputClasses"
          (input)="onInputChange($event)"
          (focus)="onFocus()"
          (blur)="onBlur()"
          (keyup.enter)="onEnter()"
          (keyup.escape)="onEscape()"
        />
        
        <!-- Botón de limpiar (opcional) -->
        <button
          *ngIf="showClear && value"
          type="button"
          class="inputsearch-clear"
          [class]="clearButtonClasses"
          (click)="clearInput()"
          [disabled]="disabled"
        >
          <svg 
            class="clear-icon" 
            viewBox="0 0 24 24" 
            fill="none" 
            stroke="currentColor" 
            stroke-width="2" 
            stroke-linecap="round" 
            stroke-linejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      
      <!-- Mensaje de ayuda o error -->
      <div 
        *ngIf="helpText || errorMessage" 
        class="inputsearch-help"
        [class]="helpClasses"
      >
        <span *ngIf="errorMessage" class="error-message">{{ errorMessage }}</span>
        <span *ngIf="!errorMessage && helpText" class="help-text">{{ helpText }}</span>
      </div>
    </div>
  `
})
export class InputsearchComponent implements OnInit, OnDestroy, ControlValueAccessor {
  @Input() type: 'text' | 'search' | 'email' | 'url' = 'text';
  @Input() placeholder = 'Search...';
  @Input() disabled = false;
  @Input() readonly = false;
  @Input() required = false;
  @Input() showClear = true;
  @Input() size: InputSearchSize = 'md';
  @Input() debounceTime = 300; // 300 ms por defecto
  @Input() helpText = '';
  @Input() errorMessage = '';
  @Input() customClasses = '';

  @Output() searchChange = new EventEmitter<string>();
  @Output() search = new EventEmitter<string>();
  @Output() focus = new EventEmitter<void>();
  @Output() blur = new EventEmitter<void>();
  @Output() enter = new EventEmitter<void>();
  @Output() escape = new EventEmitter<void>();
  @Output() clear = new EventEmitter<void>();

  value = '';
  isFocused = false;

  private destroy$ = new Subject<void>();
  private searchSubject$ = new Subject<string>();

  // ControlValueAccessor methods
  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  ngOnInit(): void {
    // Configurar el debounce para la búsqueda
    this.searchSubject$
      .pipe(
        debounceTime(this.debounceTime),
        distinctUntilChanged(),
        takeUntil(this.destroy$)
      )
      .subscribe(searchValue => {
        this.searchChange.emit(searchValue);
        this.search.emit(searchValue);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ControlValueAccessor implementation
  writeValue(value: string): void {
    this.value = value || '';
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  // Event handlers
  onInputChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.value = target.value;
    
    // Emitir el cambio inmediato para ControlValueAccessor
    this.onChange(this.value);
    
    // Emitir al subject para el debounce
    this.searchSubject$.next(this.value);
  }

  onFocus(): void {
    this.isFocused = true;
    this.focus.emit();
  }

  onBlur(): void {
    this.isFocused = false;
    this.onTouched();
    this.blur.emit();
  }

  onEnter(): void {
    this.enter.emit();
  }

  onEscape(): void {
    this.escape.emit();
  }

  clearInput(): void {
    this.value = '';
    this.onChange(this.value);
    this.searchSubject$.next(this.value);
    this.clear.emit();
  }

  // Clases CSS dinámicas
  get containerClasses(): string {
    const baseClasses = ['inputsearch-container'];
    
    const sizeClasses = {
      sm: ['inputsearch-container-sm'],
      md: ['inputsearch-container-md'],
      lg: ['inputsearch-container-lg']
    };

    const stateClasses = [
      this.disabled ? 'inputsearch-disabled' : '',
      this.errorMessage ? 'inputsearch-error' : '',
      this.isFocused ? 'inputsearch-focused' : ''
    ].filter(Boolean);

    const classes = [
      ...baseClasses,
      ...sizeClasses[this.size],
      ...stateClasses
    ];

    if (this.customClasses) {
      classes.push(this.customClasses);
    }

    return classes.join(' ');
  }

  get wrapperClasses(): string {
    const baseClasses = ['inputsearch-wrapper'];
    
    const sizeClasses = {
      sm: ['inputsearch-wrapper-sm'],
      md: ['inputsearch-wrapper-md'],
      lg: ['inputsearch-wrapper-lg']
    };

    const stateClasses = [
      this.disabled ? 'inputsearch-wrapper-disabled' : '',
      this.errorMessage ? 'inputsearch-wrapper-error' : '',
      this.isFocused ? 'inputsearch-wrapper-focused' : ''
    ].filter(Boolean);

    return [
      ...baseClasses,
      ...sizeClasses[this.size],
      ...stateClasses
    ].join(' ');
  }

  get inputClasses(): string {
    const baseClasses = ['inputsearch-input'];
    
    const sizeClasses = {
      sm: ['inputsearch-input-sm'],
      md: ['inputsearch-input-md'],
      lg: ['inputsearch-input-lg']
    };

    const stateClasses = [
      this.disabled ? 'inputsearch-input-disabled' : '',
      this.errorMessage ? 'inputsearch-input-error' : '',
      this.isFocused ? 'inputsearch-input-focused' : ''
    ].filter(Boolean);

    return [
      ...baseClasses,
      ...sizeClasses[this.size],
      ...stateClasses
    ].join(' ');
  }

  get iconClasses(): string {
    const baseClasses = ['inputsearch-icon'];
    
    const sizeClasses = {
      sm: ['inputsearch-icon-sm'],
      md: ['inputsearch-icon-md'],
      lg: ['inputsearch-icon-lg']
    };

    return [
      ...baseClasses,
      ...sizeClasses[this.size]
    ].join(' ');
  }

  get clearButtonClasses(): string {
    const baseClasses = ['inputsearch-clear'];
    
    const sizeClasses = {
      sm: ['inputsearch-clear-sm'],
      md: ['inputsearch-clear-md'],
      lg: ['inputsearch-clear-lg']
    };

    const classes = [
      ...baseClasses,
      ...sizeClasses[this.size]
    ];

    return classes.join(' ');
  }

  get helpClasses(): string {
    const baseClasses = ['inputsearch-help'];
    
    const stateClasses = [
      this.errorMessage ? 'inputsearch-help-error' : ''
    ].filter(Boolean);

    return [
      ...baseClasses,
      ...stateClasses
    ].join(' ');
  }
}