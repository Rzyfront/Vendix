import {
  Component,
  forwardRef,
  signal,
  computed,
  input,
  output,
  effect,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ControlValueAccessor,
  NG_VALUE_ACCESSOR,
} from '@angular/forms';

const DEFAULT_COLOR = '#7ED7A5';

@Component({
  selector: 'app-color-picker',
  standalone: true,
  imports: [CommonModule],
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => ColorPickerComponent),
      multi: true,
    },
  ],
  templateUrl: './color-picker.component.html',
  styleUrls: ['./color-picker.component.scss'],
})
export class ColorPickerComponent implements ControlValueAccessor {
  /**
   * One-way input binding for non-form consumers (legacy and direct
   * `[value]="..."` uses). Angular's `input()` is what makes the property
   * settable from the parent template — a plain `signal()` is internal-only
   * and would NG8002 with `Can't bind to 'value'`.
   */
  readonly value = input<string>(DEFAULT_COLOR);

  /**
   * Mirrors the latest effective color for two-way binding consumers
   * (`[(value)]`). The constructor `effect` keeps it in sync. CVA-driven
   * forms (formControlName) do NOT subscribe to this output — they receive
   * changes through `registerOnChange` instead.
   */
  readonly valueChange = output<string>();

  /**
   * Holds whatever the parent form owns when this component runs inside a
   * `[formGroup]`. `null` means "no form has spoken yet", which makes
   * `currentValue` fall back to the `value()` input. After `writeValue`
   * runs (even with `null`) the override takes over so the swatch never
   * goes blank on form reset.
   */
  private readonly cvaOverride = signal<string | null>(null);

  /**
   * Disabled state set by Angular Forms via `setDisabledState`. Kept as a
   * signal so any future template binding (e.g. `[disabled]`) reacts under
   * zoneless change detection.
   */
  readonly disabled = signal<boolean>(false);

  /**
   * Optional caller-provided swatch presets. Empty by default — the picker
   * shows only the native color input + hex text input + live preview swatch
   * (plus the session-only "Recently used" row). Opt in by passing your own
   * list, e.g. for a brand palette.
   */
  readonly presets = input<readonly string[]>([]);
  readonly recentColors = signal<string[]>([]);

  private readonly MAX_RECENT = 5;
  private onChange: (value: string) => void = () => { };
  private onTouched: () => void = () => { };

  /**
   * Effective displayed color.
   *
   * Precedence: form-driven (`cvaOverride`) wins over the `value` input.
   * This matches how a Reactive Form treats its own control as the source
   * of truth; a parent that ALSO binds `[value]` should not be racing the
   * form to render different colors.
   */
  readonly currentValue = computed<string>(() => {
    const override = this.cvaOverride();
    if (override !== null) return override;
    const input = this.value();
    return input && input.startsWith('#') ? input : DEFAULT_COLOR;
  });

  readonly isValidHex = computed<boolean>(() =>
    /^#[0-9A-Fa-f]{6}$/.test(this.currentValue()),
  );

  constructor() {
    // Emit through `valueChange` whenever the effective color changes so
    // `[(value)]` two-way binding stays in sync. CVA forms ignore this
    // output (their only listener is the `onChange` registered via
    // `registerOnChange`), so this emit never loops through the form.
    effect(() => {
      this.valueChange.emit(this.currentValue());
    });
  }

  // ---- UI handlers --------------------------------------------------------

  selectPreset(color: string): void {
    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) return;
    const normalized = color.toUpperCase();
    this.commitValue(normalized);
    this.addToRecent(normalized);
  }

  onColorInput(event: Event): void {
    const color = (event.target as HTMLInputElement).value.toUpperCase();
    this.commitValue(color);
    this.addToRecent(color);
  }

  onHexInput(event: Event): void {
    let val = (event.target as HTMLInputElement).value;
    if (!val.startsWith('#')) val = '#' + val;
    this.commitValue(val.toUpperCase());
  }

  validateHex(): void {
    if (this.isValidHex()) {
      this.addToRecent(this.currentValue());
    }
    this.onTouched();
  }

  // ---- ControlValueAccessor ----------------------------------------------

  writeValue(value: string | null): void {
    // Mirror whatever the parent form already owns. `null`/empty resets the
    // override so `currentValue` falls back to the `value()` input (which
    // defaults to DEFAULT_COLOR). This keeps a real saved color on the form
    // visible after `patchValue` instead of being masked by a hard-coded
    // fallback. Without this, `writeValue(null)` clobbered the picker with
    // DEFAULT_COLOR even when the upstream color picker component was never
    // rendered with `[value]` and the form actually owned a value.
    if (value && typeof value === 'string' && value.startsWith('#')) {
      this.cvaOverride.set(value.toUpperCase());
    } else {
      this.cvaOverride.set(null);
    }
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.disabled.set(isDisabled);
  }

  // ---- internals ----------------------------------------------------------

  /**
   * Single write path triggered by user interaction (preset click, color
   * picker input, hex text input). Updates the form-owned override AND
   * notifies the form via the registered `onChange`. The matching
   * `valueChange` output emission is handled by the constructor's effect,
   * so we do not emit it twice.
   */
  private commitValue(v: string): void {
    this.cvaOverride.set(v);
    this.onChange(v);
  }

  private addToRecent(color: string): void {
    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) return;
    this.recentColors.update((recent) => {
      const filtered = recent.filter((c) => c !== color);
      return [color, ...filtered].slice(0, this.MAX_RECENT);
    });
  }
}
