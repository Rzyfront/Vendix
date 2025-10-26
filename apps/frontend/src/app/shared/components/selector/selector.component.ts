import {
  Component,
  Input,
  Output,
  EventEmitter,
  forwardRef,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ControlValueAccessor,
  NG_VALUE_ACCESSOR,
  FormsModule,
  ReactiveFormsModule,
} from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';
import { IconComponent } from '../icon/icon.component';

export interface SelectorOption {
  value: string | number;
  label: string;
  disabled?: boolean;
  description?: string;
  icon?: string;
}

export type SelectorSize = 'sm' | 'md' | 'lg';
export type SelectorVariant = 'default' | 'outline' | 'filled';

@Component({
  selector: 'app-selector',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, IconComponent],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => SelectorComponent),
      multi: true,
    },
  ],
  template: `
    <div class="selector-container" [class]="containerClasses">
      <label
        *ngIf="label"
        class="selector-label"
        [class]="labelClasses"
        [for]="id"
      >
        {{ label }}
        <span
          *ngIf="required"
          style="color: var(--color-destructive); margin-left: 0.25rem;"
          >*</span
        >
      </label>

      <div class="selector-wrapper" [class]="wrapperClasses">
        <select
          [id]="id"
          class="selector-select"
          [class]="selectClasses"
          [disabled]="disabled"
          [required]="required"
          [(ngModel)]="selectedValue"
          (change)="onValueChange($event)"
          (blur)="onBlur()"
          (focus)="onFocus()"
        >
          <option *ngIf="placeholder" value="" disabled selected>
            {{ placeholder }}
          </option>
          <option
            *ngFor="let option of options; trackBy: trackByOption"
            [value]="option.value"
            [disabled]="option.disabled"
          >
            {{ option.label }}
          </option>
        </select>

        <div class="selector-icon" [class]="iconClasses">
          <app-icon name="chevron-down" [size]="iconSize"></app-icon>
        </div>
      </div>

      <div *ngIf="helpText || errorText" class="selector-help">
        <span *ngIf="helpText && !errorText" class="text-text-secondary">
          {{ helpText }}
        </span>
        <span *ngIf="errorText" class="text-error-500 flex items-center gap-1">
          <app-icon name="alert-circle" [size]="12"></app-icon>
          {{ errorText }}
        </span>
      </div>
    </div>
  `,
  styleUrls: ['./selector.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SelectorComponent
  implements ControlValueAccessor, OnInit, OnDestroy
{
  @Input() id = `selector-${Math.random().toString(36).substr(2, 9)}`;
  @Input() label = '';
  @Input() placeholder = '';
  @Input() helpText = '';
  @Input() errorText = '';
  @Input() required = false;
  @Input() disabled = false;
  @Input() size: SelectorSize = 'md';
  @Input() variant: SelectorVariant = 'default';
  @Input() options: SelectorOption[] = [];

  @Output() valueChange = new EventEmitter<string | number | null>();
  @Output() blur = new EventEmitter<void>();
  @Output() focus = new EventEmitter<void>();

  selectedValue: string | number | null = null;
  private destroy$ = new Subject<void>();

  // ControlValueAccessor callbacks
  private onChange: (value: string | number | null) => void = () => {};
  private onTouched: () => void = () => {};

  ngOnInit(): void {}

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ControlValueAccessor implementation
  writeValue(value: string | number | null): void {
    this.selectedValue = value;
  }

  registerOnChange(fn: (value: string | number | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled = isDisabled;
  }

  onValueChange(event: Event): void {
    const target = event.target as HTMLSelectElement;
    const value = target.value ? (target.value as string | number) : null;

    this.selectedValue = value;
    this.onChange(value);
    this.valueChange.emit(value);
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
    return [
      'selector-container',
      this.size && `selector-${this.size}`,
      this.variant && `selector-${this.variant}`,
      this.errorText ? 'selector-error' : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  get labelClasses(): string {
    return [
      'selector-label',
      this.disabled ? 'opacity-50 cursor-not-allowed' : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  get wrapperClasses(): string {
    return ['selector-wrapper'].filter(Boolean).join(' ');
  }

  get selectClasses(): string {
    return [
      'selector-select',
      this.size && `selector-${this.size}`,
      this.variant && `selector-${this.variant}`,
      this.errorText ? 'border-error-500 focus:ring-error-500' : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  get iconClasses(): string {
    return ['selector-icon'].filter(Boolean).join(' ');
  }

  get iconSize(): number {
    switch (this.size) {
      case 'sm':
        return 14;
      case 'lg':
        return 20;
      default:
        return 16;
    }
  }
}
