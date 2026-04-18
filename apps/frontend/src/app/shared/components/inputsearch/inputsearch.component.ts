import {Component,
  OnInit,
  forwardRef,
  input,
  output,
  signal,
  DestroyRef,
  inject} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  ControlValueAccessor,
  NG_VALUE_ACCESSOR,
  ReactiveFormsModule} from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { FormStyleVariant } from '../../types/form.types';

export type InputSearchSize = 'sm' | 'md' | 'lg';

@Component({
  selector: 'app-inputsearch',
  standalone: true,
  imports: [ReactiveFormsModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => InputsearchComponent),
      multi: true},
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
          [type]="type()"
          [placeholder]="placeholder()"
          [disabled]="isDisabled()"
          [readonly]="readonly()"
          [value]="value()"
          [class]="inputClasses"
          (input)="onInputChange($event)"
          (focus)="onFocus()"
          (blur)="onBlur()"
          (keyup.enter)="onEnter()"
          (keyup.escape)="onEscape()"
        />

        <!-- Botón de limpiar (opcional) -->
        @if (showClear() && value()) {
          <button
            type="button"
            class="inputsearch-clear"
            [class]="clearButtonClasses"
            (click)="clearInput()"
            [disabled]="isDisabled()"
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
        }
      </div>

      <!-- Mensaje de ayuda o error -->
      @if (helpText() || errorMessage()) {
        <div class="inputsearch-help" [class]="helpClasses">
          @if (errorMessage()) {
            <span class="error-message">{{ errorMessage() }}</span>
          }
          @if (!errorMessage() && helpText()) {
            <span class="help-text">{{ helpText() }}</span>
          }
        </div>
      }
    </div>
  `})
export class InputsearchComponent
  implements OnInit, ControlValueAccessor
{
  private destroyRef = inject(DestroyRef);
  readonly type = input<'text' | 'search' | 'email' | 'url'>('text');
  readonly placeholder = input('Buscar...');
  readonly disabled = input<boolean>(false);
  private disabledState = false;
  readonly readonly = input(false);
  readonly required = input(false);
  readonly showClear = input(true);
  readonly size = input<InputSearchSize>('md');
  readonly styleVariant = input<FormStyleVariant>('modern');
  readonly debounceTime = input(300);
  readonly helpText = input('');
  readonly errorMessage = input('');
  readonly customClasses = input('');

  readonly searchChange = output<string>();
  readonly search = output<string>();
  readonly focus = output<void>();
  readonly blur = output<void>();
  readonly enter = output<void>();
  readonly escape = output<void>();
  readonly clear = output<void>();

  readonly value = signal('');
  readonly isFocused = signal(false);
private searchSubject$ = new Subject<string>(); // LEGÍTIMO — debounceTime+distinctUntilChanged search stream

  // ControlValueAccessor methods
  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  ngOnInit(): void {
    // Configurar el debounce para la búsqueda
    this.searchSubject$
      .pipe(
        debounceTime(this.debounceTime()),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((searchValue) => {
        this.searchChange.emit(searchValue);
        this.search.emit(searchValue);
      });
  }
// ControlValueAccessor implementation
  writeValue(value: string): void {
    this.value.set(value || '');
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabledState = isDisabled;
  }

  isDisabled(): boolean {
    return this.disabled() || this.disabledState;
  }

  // Event handlers
  onInputChange(event: Event): void {
    const target = event.target as HTMLInputElement;
    const next = target.value;
    this.value.set(next);

    // Emitir el cambio inmediato para ControlValueAccessor
    this.onChange(next);

    // Emitir al subject para el debounce
    this.searchSubject$.next(next);
  }

  onFocus(): void {
    this.isFocused.set(true);
    // TODO: The 'emit' function requires a mandatory void argument
    this.focus.emit();
  }

  onBlur(): void {
    this.isFocused.set(false);
    this.onTouched();
    // TODO: The 'emit' function requires a mandatory void argument
    this.blur.emit();
  }

  onEnter(): void {
    // TODO: The 'emit' function requires a mandatory void argument
    this.enter.emit();
  }

  onEscape(): void {
    // TODO: The 'emit' function requires a mandatory void argument
    this.escape.emit();
  }

  clearInput(): void {
    this.value.set('');
    this.onChange('');
    this.searchSubject$.next('');
    // TODO: The 'emit' function requires a mandatory void argument
    this.clear.emit();
  }

  // Clases CSS dinámicas
  get containerClasses(): string {
    const baseClasses = ['inputsearch-container'];

    const variantClasses =
      this.styleVariant() === 'modern' ? ['inputsearch-modern'] : [];

    const sizeClasses =
      this.styleVariant() === 'classic'
        ? {
            sm: ['inputsearch-container-sm'],
            md: ['inputsearch-container-md'],
            lg: ['inputsearch-container-lg']}[this.size()]
        : [];

    const stateClasses = [
      this.isDisabled() ? 'inputsearch-disabled' : '',
      this.errorMessage() ? 'inputsearch-error' : '',
      this.isFocused() ? 'inputsearch-focused' : '',
    ].filter(Boolean);

    const classes = [
      ...baseClasses,
      ...variantClasses,
      ...sizeClasses,
      ...stateClasses,
    ];

    const customClasses = this.customClasses();
    if (customClasses) {
      classes.push(customClasses);
    }

    return classes.join(' ');
  }

  get wrapperClasses(): string {
    const baseClasses = ['inputsearch-wrapper'];

    const variantClasses =
      this.styleVariant() === 'modern' ? ['inputsearch-wrapper-modern'] : [];

    const sizeClasses =
      this.styleVariant() === 'classic'
        ? {
            sm: ['inputsearch-wrapper-sm'],
            md: ['inputsearch-wrapper-md'],
            lg: ['inputsearch-wrapper-lg']}[this.size()]
        : [];

    const stateClasses = [
      this.isDisabled() ? 'inputsearch-wrapper-disabled' : '',
      this.errorMessage() ? 'inputsearch-wrapper-error' : '',
      this.isFocused() ? 'inputsearch-wrapper-focused' : '',
    ].filter(Boolean);

    return [
      ...baseClasses,
      ...variantClasses,
      ...sizeClasses,
      ...stateClasses,
    ].join(' ');
  }

  get inputClasses(): string {
    const baseClasses = ['inputsearch-input'];

    const variantClasses =
      this.styleVariant() === 'modern' ? ['inputsearch-input-modern'] : [];

    const sizeClasses =
      this.styleVariant() === 'classic'
        ? {
            sm: ['inputsearch-input-sm'],
            md: ['inputsearch-input-md'],
            lg: ['inputsearch-input-lg']}[this.size()]
        : [];

    const stateClasses = [
      this.isDisabled() ? 'inputsearch-input-disabled' : '',
      this.errorMessage() ? 'inputsearch-input-error' : '',
      this.isFocused() ? 'inputsearch-input-focused' : '',
    ].filter(Boolean);

    return [
      ...baseClasses,
      ...variantClasses,
      ...sizeClasses,
      ...stateClasses,
    ].join(' ');
  }

  get iconClasses(): string {
    const baseClasses = ['inputsearch-icon'];

    const variantClasses =
      this.styleVariant() === 'modern' ? ['inputsearch-icon-modern'] : [];

    const sizeClasses =
      this.styleVariant() === 'classic'
        ? {
            sm: ['inputsearch-icon-sm'],
            md: ['inputsearch-icon-md'],
            lg: ['inputsearch-icon-lg']}[this.size()]
        : [];

    return [...baseClasses, ...variantClasses, ...sizeClasses].join(' ');
  }

  get clearButtonClasses(): string {
    const baseClasses = ['inputsearch-clear'];

    const variantClasses =
      this.styleVariant() === 'modern' ? ['inputsearch-clear-modern'] : [];

    const sizeClasses =
      this.styleVariant() === 'classic'
        ? {
            sm: ['inputsearch-clear-sm'],
            md: ['inputsearch-clear-md'],
            lg: ['inputsearch-clear-lg']}[this.size()]
        : [];

    return [...baseClasses, ...variantClasses, ...sizeClasses].join(' ');
  }

  get helpClasses(): string {
    const baseClasses = ['inputsearch-help'];

    const stateClasses = [
      this.errorMessage() ? 'inputsearch-help-error' : '',
    ].filter(Boolean);

    return [...baseClasses, ...stateClasses].join(' ');
  }
}
