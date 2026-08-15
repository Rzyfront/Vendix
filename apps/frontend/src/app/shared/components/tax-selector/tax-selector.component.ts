import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { SelectorComponent } from '../selector/selector.component';
import { ToggleComponent } from '../toggle/toggle.component';

/**
 * QUI-690 — Selector compartido de impuesto con flag
 * `is_inclusive` (incluido en `unit_price` o adicional). Sustituye al input
 * numérico plano `% IVA` del modal de creación de factura.
 *
 * Por ahora consume un universo plano de `TaxOption` (la fachada carga los
 * `tax_rates` desde el backend; el componente no conoce el dominio). Cuando
 * `app-tax-selector` se conecte al servicio real (`TaxesService`), este
 * componente recibirá un universo cargado asincrónicamente.
 */
export interface TaxOption {
  /** id de `tax_rates` (cuando viene del backend) o id sintético. */
  id: number;
  /** Nombre visible, p.ej. "IVA 19%". */
  name: string;
  /** Tasa numérica (porcentaje, p.ej. 19 para 19%). */
  rate: number;
  /** Tipo fiscal (iva / inc / ica / retefuente / reteiva / reteica). */
  tax_type?: string;
  /**
   * Default del catálogo (`tax_rates.is_inclusive`). El picker lo usa como
   * valor inicial del toggle cuando el usuario no ha tomado una decisión
   * explícita.
   */
  default_is_inclusive?: boolean;
}

/**
 * Payload emitido por `app-tax-selector` al confirmar.
 */
export interface TaxSelection {
  tax_rate_id: number;
  rate: number;
  name: string;
  tax_type?: string;
  /** Inclusivo en `unit_price` (true) o adicional (false). */
  is_inclusive: boolean;
  /**
   * Tasa numérica que el caller debe usar en cálculos: si es inclusivo, el
   * `unit_price` YA lleva el impuesto; si es adicional, el `unit_price` se
   * mantiene intacto y el impuesto se suma aparte.
   */
}

@Component({
  selector: 'app-tax-selector',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, SelectorComponent, ToggleComponent],
  template: `
    <div class="flex flex-col gap-2">
      <app-selector
        label="Impuesto"
        [options]="taxOptions()"
        [required]="required()"
        [ngModel]="selectedId()"
        (ngModelChange)="onSelectRate($event)"
        placeholder="Selecciona un impuesto"
        size="sm"
      />

      @if (selectedId() !== null) {
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs text-[var(--color-text-secondary)]">
            Tipo de aplicación
          </span>
          <app-toggle
            [ngModel]="isInclusive()"
            (ngModelChange)="onToggleInclusive($event)"
            [labelLeft]="'Adicional'"
            [labelRight]="'Incluido'"
          />
        </div>
        <p class="text-[11px] text-[var(--color-text-muted)]">
          @if (isInclusive()) {
            El impuesto está <strong>incluido</strong> en el precio unitario
            ({{ formatRate(selectedRate()?.rate) }}% ya viene sumado al
            valor mostrado).
          } @else {
            El impuesto es <strong>adicional</strong> al precio unitario
            (se suma aparte en el total).
          }
        </p>
      }
    </div>
  `,
  styleUrl: './tax-selector.component.scss',
})
export class TaxSelectorComponent {
  /**
   * Universo de impuestos disponibles. En esta versión inicial el padre
   * lo inyecta; cuando se conecte a `TaxesService`, este input será
   * opcional y el componente cargará su propio universo.
   */
  readonly taxes = input<TaxOption[]>([]);
  /** Si es true, el botón submit queda deshabilitado sin selección. */
  readonly required = input<boolean>(true);

  /** Emite la selección al cambiar. */
  readonly selectionChange = output<TaxSelection | null>();

  /** id del impuesto seleccionado (sincronizado con `app-selector`). */
  readonly selectedId = signal<number | null>(null);
  /** Flag inclusive/adicional (sincronizado con `app-toggle`). */
  readonly isInclusive = signal<boolean>(false);

  readonly selectedRate = computed<TaxOption | null>(() => {
    const id = this.selectedId();
    if (id == null) return null;
    return this.taxes().find((t) => t.id === id) ?? null;
  });

  /** Opciones en formato `SelectorOption` que espera `app-selector`. */
  readonly taxOptions = computed(() =>
    this.taxes().map((t) => ({
      value: t.id,
      label: t.name,
      description: t.tax_type ? `${t.tax_type.toUpperCase()} · ${t.rate}%` : `${t.rate}%`,
    })),
  );

  onSelectRate(id: number | string | null): void {
    const numericId = id == null ? null : Number(id);
    this.selectedId.set(numericId);
    if (numericId == null) {
      this.isInclusive.set(false);
      this.selectionChange.emit(null);
      return;
    }
    const rate = this.selectedRate();
    const defaultInc = rate?.default_is_inclusive ?? false;
    this.isInclusive.set(defaultInc);
    this.emitSelection();
  }

  onToggleInclusive(value: boolean): void {
    this.isInclusive.set(value);
    this.emitSelection();
  }

  private emitSelection(): void {
    const rate = this.selectedRate();
    if (rate == null) {
      this.selectionChange.emit(null);
      return;
    }
    this.selectionChange.emit({
      tax_rate_id: rate.id,
      rate: rate.rate,
      name: rate.name,
      tax_type: rate.tax_type,
      is_inclusive: this.isInclusive(),
    });
  }

  /** Formatea la tasa como porcentaje entero cuando es exacta, sino con 2 decimales. */
  formatRate(rate: number | null | undefined): string {
    if (rate == null) return '0';
    return Number.isInteger(rate) ? `${rate}` : rate.toFixed(2);
  }
}
