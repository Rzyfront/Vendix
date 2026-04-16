import {
  Component,
  Input,
  forwardRef,
  input,
  output
} from '@angular/core';

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
    imports: [FormsModule, ReactiveFormsModule, ToggleComponent],
    providers: [
        {
            provide: NG_VALUE_ACCESSOR,
            useExisting: forwardRef(() => SettingToggleComponent),
            multi: true,
        },
    ],
    template: `
    <div
      class="flex items-center justify-between p-2 mt-3 bg-gray-50 border border-gray-100 rounded-xl transition-all hover:bg-gray-100/50 cursor-pointer select-none"
      [class.opacity-50]="disabled"
      [class.cursor-not-allowed]="disabled"
      [class.new-highlight]="isNew()"
      (click)="onToggle(!value)"
      >
      <div class="flex-1 mr-4">
        <label class="text-xs font-semibold text-gray-700 block">
          {{ label() }}
          @if (isNew()) {
            <span class="new-badge">Nuevo</span>
          }
        </label>
        @if (description) {
          <p class="text-[10px] text-gray-500 leading-tight mt-0.5">
            {{ description }}
          </p>
        }
      </div>
      <app-toggle
        class="shrink-0"
        [checked]="value"
        [disabled]="disabled"
        (changed)="onToggle($event)"
        (click)="$event.stopPropagation()"
      ></app-toggle>
    </div>
    `,
    styles: [`
      :host {
        cursor: pointer;
      }

      .new-highlight {
        border-color: #f97316 !important;
        background: rgba(249, 115, 22, 0.05) !important;
      }
      .new-badge {
        font-size: 9px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #f97316;
        background: rgba(249, 115, 22, 0.1);
        padding: 1px 6px;
        border-radius: 9999px;
        margin-left: 4px;
      }
    `],
})
export class SettingToggleComponent implements ControlValueAccessor {
    readonly label = input<string>('');
    @Input() description?: string;
    @Input() disabled = false;
    readonly isNew = input(false);

    readonly changed = output<boolean>();

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
