import {
    Component,
    Input,
    Output,
    EventEmitter,
    forwardRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
    ControlValueAccessor,
    NG_VALUE_ACCESSOR,
    ReactiveFormsModule,
    FormsModule,
} from '@angular/forms';
import { ToggleComponent } from '../toggle/toggle.component';

@Component({
    selector: 'app-setting-toggle',
    standalone: true,
    imports: [CommonModule, FormsModule, ReactiveFormsModule, ToggleComponent],
    providers: [
        {
            provide: NG_VALUE_ACCESSOR,
            useExisting: forwardRef(() => SettingToggleComponent),
            multi: true,
        },
    ],
    template: `
    <div
      class="flex items-center justify-between p-3 bg-gray-50 border border-gray-100 rounded-xl transition-all hover:bg-gray-100/50"
      [class.opacity-50]="disabled"
      [class.cursor-not-allowed]="disabled"
    >
      <div class="flex-1 mr-4">
        <label class="text-xs font-semibold text-gray-700 block">
          {{ label }}
        </label>
        <p *ngIf="description" class="text-[10px] text-gray-500 leading-tight mt-0.5">
          {{ description }}
        </p>
      </div>
      <app-toggle
        [checked]="value"
        [disabled]="disabled"
        (changed)="onToggle($event)"
      ></app-toggle>
    </div>
  `,
})
export class SettingToggleComponent implements ControlValueAccessor {
    @Input() label: string = '';
    @Input() description?: string;
    @Input() disabled = false;

    @Output() changed = new EventEmitter<boolean>();

    value = false;

    private onChange: (value: boolean) => void = () => { };
    private onTouched: () => void = () => { };

    writeValue(value: boolean): void {
        this.value = !!value;
    }

    registerOnChange(fn: (value: boolean) => void): void {
        this.onChange = fn;
    }

    registerOnTouched(fn: () => void): void {
        this.onTouched = fn;
    }

    setDisabledState(disabled: boolean): void {
        this.disabled = disabled;
    }

    onToggle(value: boolean): void {
        if (this.disabled) return;
        this.value = value;
        this.onChange(this.value);
        this.changed.emit(this.value);
        this.onTouched();
    }
}
