import {
  Component,
  forwardRef,
  input,
  output,
  signal,
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
      class="setting-toggle-row flex items-center justify-between p-2 mt-3 bg-gray-50 border border-gray-100 rounded-xl hover:bg-gray-100/50 select-none"
      [class.opacity-50]="disabled()"
      [class.is-disabled]="disabled()"
      [class.new-highlight]="isNew()"
      role="button"
      [attr.tabindex]="disabled() ? -1 : 0"
      [attr.aria-pressed]="value()"
      [attr.aria-disabled]="disabled()"
      (click)="onToggle(!value())"
      (keydown.enter)="onToggle(!value()); $event.preventDefault()"
      (keydown.space)="onToggle(!value()); $event.preventDefault()"
      >
      <div class="flex-1 mr-4 pointer-events-none">
        <label class="text-xs font-semibold text-gray-700 block">
          {{ label() }}
          @if (isNew()) {
            <span class="new-badge">Nuevo</span>
          }
        </label>
        @if (description()) {
          <p class="text-[10px] text-gray-500 leading-tight mt-0.5">
            {{ description() }}
          </p>
        }
      </div>
      <app-toggle
        class="shrink-0"
        [checked]="value()"
        [disabled]="disabled()"
        (changed)="onToggle($event)"
        (click)="$event.stopPropagation()"
      ></app-toggle>
    </div>
    `,
    styles: [`
      :host {
        display: block;
        cursor: pointer;
      }

      .setting-toggle-row {
        cursor: pointer;
      }
      .setting-toggle-row, .setting-toggle-row * {
        cursor: inherit;
      }
      .setting-toggle-row.is-disabled,
      .setting-toggle-row.is-disabled * {
        cursor: not-allowed;
      }

      .setting-toggle-row:active:not(.is-disabled) {
        background: rgba(0, 0, 0, 0.04);
        transform: scale(0.997);
      }

      .setting-toggle-row:focus-visible {
        outline: 2px solid var(--color-ring, #7ed7a5);
        outline-offset: 2px;
      }

      /* Asegura cursor pointer en el button interno del app-toggle */
      :host ::ng-deep app-toggle button {
        cursor: pointer;
      }
      :host ::ng-deep app-toggle button:disabled {
        cursor: not-allowed;
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
    readonly description = input<string | undefined>(undefined);
    readonly isNew = input(false);

    readonly changed = output<boolean>();

    readonly value = signal(false);
    readonly disabled = signal(false);

    private onChange: (value: boolean) => void = () => { };
    private onTouched: () => void = () => { };

    writeValue(value: boolean): void {
        this.value.set(!!value);
    }

    registerOnChange(fn: (value: boolean) => void): void {
        this.onChange = fn;
    }

    registerOnTouched(fn: () => void): void {
        this.onTouched = fn;
    }

    setDisabledState(disabled: boolean): void {
        this.disabled.set(disabled);
    }

    onToggle(value: boolean): void {
        if (this.disabled()) return;
        this.value.set(value);
        this.onChange(value);
        this.changed.emit(value);
        this.onTouched();
    }
}
