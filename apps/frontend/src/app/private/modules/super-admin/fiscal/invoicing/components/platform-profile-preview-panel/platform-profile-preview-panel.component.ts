import { Component, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef } from '@angular/core';

import {
  ButtonComponent,
  IconComponent,
  InputComponent,
} from '../../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/index';
import { PlatformInvoicingStore } from '../../platform-invoicing.store';
import type { PlatformProfilePreviewResult } from '../../../../subscriptions/interfaces/fiscal-billing.interface';

/**
 * Panel de previsualización del perfil de plataforma.
 *
 * Mismo comportamiento que `vendix-invoice-profile-preview-panel` del riel tienda,
 * adaptado al contexto de plataforma. La diferencia semántica es que el preview
 * de plataforma NUNCA reserva numeración: `not_performed.numbering_reserved`
 * siempre es `false`. Se muestra explícitamente para evitar que el operador
 * crea que burnó un consecutivo autorizado.
 */
@Component({
  selector: 'app-platform-profile-preview-panel',
  standalone: true,
  imports: [ReactiveFormsModule, ButtonComponent, IconComponent, InputComponent],
  template: `
    <div class="flex flex-col gap-3">
      <form [formGroup]="form" class="grid grid-cols-1 gap-2 md:grid-cols-3">
        <app-input
          label="Valor del contrato"
          formControlName="contract_value"
          type="number"
          helperText="Base del cálculo. Mueve el piso legal."
        ></app-input>
        @if (showAiu()) {
          <app-input
            label="Valor A+I+U"
            formControlName="aiu_value"
            type="number"
            helperText="Suma de administración, imprevistos y utilidad."
          ></app-input>
        }
        <div class="flex items-end">
          <app-button
            variant="primary"
            [disabled]="loading() || profileId() === null"
            (clicked)="runPreview()"
          >
            <app-icon slot="icon" name="eye" [size]="16"></app-icon>
            {{ loading() ? 'Calculando…' : 'Previsualizar' }}
          </app-button>
        </div>
        <div class="md:col-span-3">
          <app-input
            label="Objeto del contrato (solo para esta prueba)"
            formControlName="contract_object"
            type="text"
            helperText="No modifica el perfil. Se usa únicamente para armar el documento de muestra."
          ></app-input>
        </div>
      </form>

      @if (profileId() === null) {
        <div
          class="rounded-lg border border-border px-3 py-2 text-xs text-text-secondary md:text-sm"
          role="status"
        >
          Guarda el perfil para poder previsualizar: el documento de muestra se
          arma con la versión ya guardada, no con lo que está sin guardar.
        </div>
      }

      @if (error(); as failure) {
        <div
          class="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger md:text-sm"
          role="alert"
        >
          <strong>{{ failure.code }}</strong> — {{ failure.message }}
        </div>
      }

      @if (preview(); as result) {
        <!-- Not-performed: explícito sobre numbering_reserved=false -->
        <div
          class="rounded-lg border border-info/40 bg-info/5 px-3 py-2 text-xs md:text-sm"
          role="status"
        >
          <p class="font-semibold">Esto es una muestra, no una factura.</p>
          <ul class="mt-1 list-inside list-disc">
            <li>No se reservó numeración ni se consumió consecutivo.</li>
            <li>No se firmó digitalmente.</li>
            <li>No se transmitió a la DIAN.</li>
            <li>No se guardó ningún registro.</li>
          </ul>
          <p class="mt-1 text-text-secondary">
            Perfil {{ result.profile.name }} · versión v{{ result.profile.version }}
          </p>
        </div>

        <!-- AIU summary -->
        @if (result.aiu_summary; as aiu) {
          <div class="grid grid-cols-2 gap-2 md:grid-cols-4">
            <div class="rounded-lg border border-border p-2">
              <p class="text-[11px] text-text-secondary">Valor del contrato</p>
              <p class="text-sm font-semibold">{{ money(aiu.contract_value) }}</p>
            </div>
            <div class="rounded-lg border border-border p-2">
              <p class="text-[11px] text-text-secondary">A+I+U</p>
              <p class="text-sm font-semibold">{{ money(aiu.aiu_value) }}</p>
            </div>
            <div class="rounded-lg border border-primary p-2">
              <p class="text-[11px] text-text-secondary">Base gravable</p>
              <p class="text-sm font-semibold">{{ money(aiu.taxable_base) }}</p>
            </div>
            <div class="rounded-lg border border-border p-2">
              <p class="text-[11px] text-text-secondary">Mínimo legal</p>
              <p class="text-sm font-semibold">{{ money(aiu.minimum_base) }}</p>
            </div>
          </div>
        }

        <!-- Líneas -->
        <div class="overflow-x-auto">
          <table class="w-full min-w-[640px] text-left text-xs md:text-sm">
            <caption class="sr-only">Desglose línea por línea del documento de muestra</caption>
            <thead class="border-b border-border text-text-secondary">
              <tr>
                <th scope="col" class="py-1 pr-2">#</th>
                <th scope="col" class="py-1 pr-2">Concepto</th>
                <th scope="col" class="py-1 pr-2 text-right">Valor</th>
                <th scope="col" class="py-1 pr-2 text-right">Impuesto</th>
                <th scope="col" class="py-1">Gravabilidad</th>
              </tr>
            </thead>
            <tbody>
              @for (line of result.breakdown.lines; track line.index) {
                <tr class="border-b border-border/50">
                  <td class="py-1 pr-2">{{ line.index }}</td>
                  <td class="py-1 pr-2">
                    {{ line.description }}
                    <span class="text-text-secondary">· {{ bucketLabel(line.bucket) }}</span>
                  </td>
                  <td class="py-1 pr-2 text-right">{{ money(line.line_extension_amount) }}</td>
                  <td class="py-1 pr-2 text-right">{{ money(line.tax_amount) }}</td>
                  <td class="py-1">{{ taxabilityLabel(line) }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <!-- Totales -->
        <div class="grid grid-cols-2 gap-2 md:grid-cols-3">
          <div class="rounded-lg border border-border p-2">
            <p class="text-[11px] text-text-secondary">Suma de líneas</p>
            <p class="text-sm font-semibold">{{ money(result.breakdown.totals.line_extension_amount) }}</p>
          </div>
          <div class="rounded-lg border border-border p-2">
            <p class="text-[11px] text-text-secondary">Descuentos</p>
            <p class="text-sm font-semibold">{{ money(result.breakdown.totals.discount_amount) }}</p>
          </div>
          <div class="rounded-lg border border-primary p-2">
            <p class="text-[11px] text-text-secondary">Base gravable</p>
            <p class="text-sm font-semibold">{{ money(result.breakdown.totals.tax_exclusive_amount) }}</p>
          </div>
          <div class="rounded-lg border border-border p-2">
            <p class="text-[11px] text-text-secondary">Impuestos</p>
            <p class="text-sm font-semibold">{{ money(result.breakdown.totals.tax_amount) }}</p>
          </div>
          <div class="rounded-lg border border-border p-2">
            <p class="text-[11px] text-text-secondary">Total</p>
            <p class="text-sm font-semibold">{{ money(result.breakdown.totals.tax_inclusive_amount) }}</p>
          </div>
          <div class="rounded-lg border border-primary p-2">
            <p class="text-[11px] text-text-secondary">Total a pagar</p>
            <p class="text-sm font-semibold">{{ money(result.breakdown.totals.payable_amount) }}</p>
          </div>
        </div>

        <!-- Validaciones -->
        @if (result.validations.length > 0) {
          <div class="rounded-lg border border-border px-3 py-2">
            <p class="text-[11px] font-semibold text-text-secondary mb-1">Validaciones</p>
            @for (v of result.validations; track v.rule) {
              <div
                class="text-xs"
                [class.text-danger]="v.severity === 'blocker'"
                [class.text-warning]="v.severity === 'warning'"
                [class.text-text-secondary]="v.severity === 'info'"
              >
                <span class="font-medium">{{ v.severity.toUpperCase() }}</span>: {{ v.message }}
              </div>
            }
          </div>
        }
      }
    </div>
  `,
})
export class PlatformProfilePreviewPanelComponent {
  private readonly store = inject(PlatformInvoicingStore);
  private readonly fb = inject(FormBuilder);
  private readonly currency = inject(CurrencyFormatService);
  private readonly destroyRef = inject(DestroyRef);

  readonly profileId = input<number | null>(null);
  readonly isAiu = input(false);

  readonly preview = signal<PlatformProfilePreviewResult | null>(null);
  readonly loading = signal(false);
  readonly error = signal<{ code: string; message: string } | null>(null);

  readonly form = this.fb.group({
    contract_value: [1000000],
    aiu_value: [0],
    contract_object: [''],
  });

  readonly showAiu = computed(() => this.isAiu());

  money(value: string | number | null | undefined): string {
    if (value == null) return '—';
    return this.currency.format(String(value));
  }

  bucketLabel(bucket: string): string {
    const labels: Record<string, string> = {
      administracion: 'Administración',
      imprevistos: 'Imprevistos',
      utilidad: 'Utilidad',
      costo: 'Costo reembolsable',
    };
    return labels[bucket] ?? bucket;
  }

  taxabilityLabel(line: { omit_tax_total?: boolean | null }): string {
    return line.omit_tax_total ? 'Exento' : 'Gravado';
  }

  runPreview(): void {
    const id = this.profileId();
    if (id === null) return;

    this.loading.set(true);
    this.error.set(null);

    const { contract_value, aiu_value, contract_object } = this.form.value;
    const dto = {
      contract_value: contract_value != null ? Number(contract_value) : undefined,
      aiu_value: aiu_value != null ? Number(aiu_value) : undefined,
      contract_object: contract_object || undefined,
      issue_date: new Date().toISOString().split('T')[0],
    };

    this.store
      .previewProfile(id, dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.preview.set(result);
          this.loading.set(false);
        },
        error: (err: any) => {
          this.error.set({
            code: err?.error_code ?? 'ERR',
            message: err?.message ?? 'No se pudo generar la previsualización.',
          });
          this.loading.set(false);
        },
      });
  }
}
