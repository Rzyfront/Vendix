import {
  Directive,
  ElementRef,
  forwardRef,
  inject,
  input,
  effect,
  Renderer2,
} from '@angular/core';
import {
  ControlValueAccessor,
  NG_VALUE_ACCESSOR,
} from '@angular/forms';
import { CurrencyFormatService } from '../pipes/currency/currency.pipe';

/**
 * Directiva para formatear valores monetarios en tiempo real dentro de inputs.
 * Muestra el valor formateado con separadores de miles mientras el usuario escribe,
 * pero mantiene el valor numérico real en el FormControl.
 *
 * @example
 * <input appCurrencyInput formControlName="base_price" placeholder="0.00" />
 * <input appCurrencyInput [currencyDecimals]="0" formControlName="total" />
 */
@Directive({
  selector: 'input[appCurrencyInput]',
  standalone: true,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CurrencyInputDirective),
      multi: true,
    },
  ],
  host: {
    '(input)': 'onInputEvent($event)',
    '(blur)': 'onBlurEvent()',
    '(focus)': 'onFocusEvent()',
    '(paste)': 'onPasteEvent($event)',
    '(keydown)': 'onKeydownEvent($event)',
    '[attr.type]': '"text"',
    '[attr.inputmode]': '"decimal"',
  },
})
export class CurrencyInputDirective implements ControlValueAccessor {
  private readonly el = inject(ElementRef<HTMLInputElement>);
  private readonly renderer = inject(Renderer2);
  private readonly currencyService = inject(CurrencyFormatService);

  /** Override decimal places (defaults to currency config) */
  currencyDecimals = input<number | undefined>(undefined);

  /** Allow negative values */
  allowNegative = input<boolean>(false);

  private rawValue: number | null = null;
  private onChange: (value: number | null) => void = () => {};
  private onTouched: () => void = () => {};
  private isFocused = false;

  constructor() {
    // Re-format display when currency config changes
    effect(() => {
      // Read signals to track
      this.currencyService.currencyFormatStyle();
      this.currencyService.currencyDecimals();
      this.currencyDecimals();

      if (!this.isFocused) {
        this.setDisplayValue(this.formatForDisplay(this.rawValue));
      }
    });
  }

  // =========================================================================
  // ControlValueAccessor
  // =========================================================================

  writeValue(value: number | null): void {
    this.rawValue = value ?? null;
    if (!this.isFocused) {
      this.setDisplayValue(this.formatForDisplay(this.rawValue));
    }
  }

  registerOnChange(fn: (value: number | null) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(isDisabled: boolean): void {
    this.renderer.setProperty(this.el.nativeElement, 'disabled', isDisabled);
  }

  // =========================================================================
  // Event Handlers
  // =========================================================================

  onInputEvent(event: Event): void {
    const input = this.el.nativeElement;
    const cursorPos = input.selectionStart ?? 0;
    const oldValue = input.value;

    const sanitized = this.sanitize(oldValue);
    const formatted = this.formatLive(sanitized);

    const newCursorPos = this.adjustCursorPosition(oldValue, formatted, cursorPos);

    this.setDisplayValue(formatted);
    input.setSelectionRange(newCursorPos, newCursorPos);

    this.rawValue = this.parseFromDisplay(sanitized);
    this.onChange(this.rawValue);
  }

  onBlurEvent(): void {
    this.isFocused = false;
    this.onTouched();
    // Full format with padded decimals
    this.setDisplayValue(this.formatForDisplay(this.rawValue));
  }

  onFocusEvent(): void {
    this.isFocused = true;
    // Keep formatted value on focus (user can still type normally)
  }

  onPasteEvent(event: ClipboardEvent): void {
    event.preventDefault();
    const pasted = event.clipboardData?.getData('text') || '';
    const input = this.el.nativeElement;
    const start = input.selectionStart ?? 0;
    const end = input.selectionEnd ?? 0;
    const current = input.value;

    // Insert pasted text at cursor position
    const newValue = current.slice(0, start) + pasted + current.slice(end);
    input.value = newValue;

    // Trigger the input handler to sanitize and format
    this.onInputEvent(new Event('input'));
  }

  onKeydownEvent(event: KeyboardEvent): void {
    const { decimal } = this.getSeparators();

    // Always allow: navigation, selection, clipboard
    const allowedKeys = [
      'Backspace', 'Delete', 'Tab', 'Escape', 'Enter',
      'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
      'Home', 'End',
    ];
    if (allowedKeys.includes(event.key)) return;

    // Allow Ctrl/Cmd shortcuts (copy, paste, select all, cut, undo, redo)
    if (event.ctrlKey || event.metaKey) return;

    // Allow digits
    if (event.key >= '0' && event.key <= '9') return;

    // Allow minus at position 0 if allowed
    if (event.key === '-' && this.allowNegative()) {
      const input = this.el.nativeElement;
      if ((input.selectionStart ?? 0) === 0 && !input.value.includes('-')) return;
    }

    // Allow decimal separator (only one)
    if (event.key === decimal || (decimal === ',' && event.key === ',') || (decimal === '.' && event.key === '.')) {
      const input = this.el.nativeElement;
      if (!input.value.includes(decimal)) return;
    }

    // Also allow '.' and ',' as decimal input regardless (will be sanitized)
    if (event.key === '.' || event.key === ',') {
      const input = this.el.nativeElement;
      if (!input.value.includes(decimal)) return;
    }

    // Block everything else
    event.preventDefault();
  }

  // =========================================================================
  // Formatting
  // =========================================================================

  private getSeparators(): { thousands: string; decimal: string } {
    const style = this.currencyService.currencyFormatStyle();
    switch (style) {
      case 'dot_comma':   return { thousands: '.', decimal: ',' };
      case 'space_comma': return { thousands: '\u00A0', decimal: ',' };
      case 'comma_dot':
      default:            return { thousands: ',', decimal: '.' };
    }
  }

  private getDecimals(): number {
    return this.currencyDecimals() ?? this.currencyService.currencyDecimals();
  }

  /**
   * Full format for display (on blur / programmatic set).
   * Pads decimals to exact count.
   */
  private formatForDisplay(value: number | null): string {
    if (value === null || value === undefined) return '';
    const { thousands, decimal } = this.getSeparators();
    const decimals = this.getDecimals();

    const isNegative = value < 0;
    const absValue = Math.abs(value);
    const fixed = absValue.toFixed(decimals);
    const [intPart, decPart] = fixed.split('.');

    const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);

    let result = decimals > 0 ? `${withThousands}${decimal}${decPart}` : withThousands;
    if (isNegative) result = '-' + result;
    return result;
  }

  /**
   * Live format while typing.
   * Preserves partial decimal input (e.g., "123," stays as "123,").
   */
  private formatLive(sanitized: string): string {
    if (!sanitized || sanitized === '-') return sanitized;
    const { thousands, decimal } = this.getSeparators();
    const maxDecimals = this.getDecimals();

    const isNegative = sanitized.startsWith('-');
    let value = isNegative ? sanitized.slice(1) : sanitized;

    // Split at decimal separator
    const decIndex = value.indexOf(decimal);
    let intPart: string;
    let decPart: string | null = null;

    if (decIndex !== -1) {
      intPart = value.slice(0, decIndex);
      decPart = value.slice(decIndex + 1);
    } else {
      intPart = value;
    }

    // Remove leading zeros (keep at least one digit)
    intPart = intPart.replace(/^0+(?=\d)/, '');
    if (intPart === '') intPart = '0';

    // Add thousands separators
    intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);

    let result = intPart;
    if (decPart !== null) {
      result += decimal + decPart.slice(0, maxDecimals);
    }

    if (isNegative) result = '-' + result;
    return result;
  }

  /**
   * Parse a display string back to a numeric value.
   */
  private parseFromDisplay(displayValue: string): number | null {
    if (!displayValue || displayValue.trim() === '' || displayValue === '-') return null;
    const { thousands, decimal } = this.getSeparators();

    // Remove thousands separators
    let cleaned = displayValue;
    const thousandsRegex = new RegExp(this.escapeRegex(thousands), 'g');
    cleaned = cleaned.replace(thousandsRegex, '');

    // Replace decimal separator with '.'
    if (decimal !== '.') {
      cleaned = cleaned.replace(decimal, '.');
    }

    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }

  /**
   * Remove all characters except digits, decimal separator, and leading minus.
   */
  private sanitize(value: string): string {
    const { decimal, thousands } = this.getSeparators();
    let result = '';
    let hasDecimal = false;
    const maxDecimals = this.getDecimals();

    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (ch >= '0' && ch <= '9') {
        // If we're past the decimal, limit digits
        if (hasDecimal) {
          const afterDecimal = result.slice(result.indexOf(decimal) + 1);
          if (afterDecimal.length >= maxDecimals) continue;
        }
        result += ch;
      } else if (ch === '-' && i === 0 && this.allowNegative()) {
        result += ch;
      } else if (ch === thousands || ch === '\u00A0') {
        // Thousands separator → skip (added automatically by formatLive)
        continue;
      } else if ((ch === decimal || ch === '.' || ch === ',') && !hasDecimal && maxDecimals > 0) {
        // Any remaining '.' or ',' that isn't the thousands separator → decimal
        result += decimal;
        hasDecimal = true;
      }
    }
    return result;
  }

  /**
   * Adjust cursor position after reformatting to account for added/removed separators.
   */
  private adjustCursorPosition(oldValue: string, newValue: string, oldCursor: number): number {
    const { thousands } = this.getSeparators();

    // Count content characters (non-separator) before cursor in old value
    let contentCharsBefore = 0;
    for (let i = 0; i < oldCursor; i++) {
      if (oldValue[i] !== thousands && oldValue[i] !== '\u00A0') {
        contentCharsBefore++;
      }
    }

    // Find same position in new value
    let newCursor = 0;
    let counted = 0;
    for (let i = 0; i < newValue.length; i++) {
      if (counted >= contentCharsBefore) break;
      newCursor = i + 1;
      if (newValue[i] !== thousands && newValue[i] !== '\u00A0') {
        counted++;
      }
    }

    return newCursor;
  }

  private setDisplayValue(value: string): void {
    this.renderer.setProperty(this.el.nativeElement, 'value', value);
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
