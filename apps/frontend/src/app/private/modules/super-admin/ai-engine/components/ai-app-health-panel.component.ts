import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DecimalPipe } from '@angular/common';
import { FormControl, FormGroup } from '@angular/forms';

import { AIEngineService } from '../services/ai-engine.service';
import { AIAppHealthQuery, AIAppHealthRow } from '../interfaces';
import {
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  InputComponent,
  ToastService,
} from '../../../../../shared/components/index';
import { toLocalDateString } from '../../../../../shared/utils/date.util';

const DEFAULT_DAYS = 7;
/** Tasa (0-100) desde la que una celda se marca en rojo. */
const ALERT_RATE = 5;

/**
 * Convierte el rango del formulario (días locales `YYYY-MM-DD`) en instantes
 * ISO: desde el inicio del primer día hasta el final del último, en la hora
 * del navegador. Un día vacío o inválido se omite (el backend usa 7 días).
 */
export function buildAppHealthQuery(
  from: string,
  to: string,
): AIAppHealthQuery {
  const day = (value: string, time: string): string | undefined => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
    const date = new Date(`${value}T${time}`);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  };
  return {
    date_from: day(from, '00:00:00'),
    date_to: day(to, '23:59:59.999'),
  };
}

/**
 * Salud por app (ia-cargas F6): por cada `app_key`, cuántas llamadas hubo,
 * qué porcentaje falló, se cortó (`finish_reason = length`) o no pasó la
 * validación del esquema, y cuántos tokens usa en promedio. Solo lectura.
 */
@Component({
  selector: 'app-ai-app-health-panel',
  standalone: true,
  imports: [
    DecimalPipe,
    ButtonComponent,
    CardComponent,
    EmptyStateComponent,
    InputComponent,
  ],
  template: `
    <div
      class="rounded-lg border border-border bg-background p-4 space-y-1 mb-4"
    >
      <h3 class="text-sm font-semibold text-text-primary">Salud por app</h3>
      <p class="text-sm text-text-secondary">
        Cada fila es una app de IA. <strong>% cortadas</strong> son respuestas
        que el modelo no terminó por falta de tokens (las cargas las parten y
        reintentan); <strong>% validación</strong> son respuestas que no
        cumplieron el esquema; <strong>% error</strong> son llamadas que el
        proveedor no respondió. Por defecto, los últimos 7 días.
      </p>
    </div>

    <app-card>
      <div class="flex flex-col gap-3 md:flex-row md:items-end">
        <div class="md:w-48">
          <app-input
            label="Desde"
            type="date"
            size="sm"
            [control]="range.controls.from"
          />
        </div>
        <div class="md:w-48">
          <app-input
            label="Hasta"
            type="date"
            size="sm"
            [control]="range.controls.to"
          />
        </div>
        <app-button
          variant="primary"
          size="sm"
          [loading]="isLoading()"
          (clicked)="load()"
        >
          Consultar
        </app-button>
      </div>

      @if (isLoading() && rows().length === 0) {
        <p class="mt-4 text-sm text-text-secondary">Cargando…</p>
      } @else if (rows().length === 0) {
        <div class="mt-4">
          <app-empty-state
            icon="activity"
            title="Sin llamadas en el rango"
            description="Ninguna app de IA registró llamadas entre esas fechas."
            [showActionButton]="false"
          ></app-empty-state>
        </div>
      } @else {
        <div class="mt-4 overflow-x-auto">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-border text-left text-text-secondary">
                <th class="py-2 pr-4 font-medium">App</th>
                <th class="py-2 pr-4 text-right font-medium">Llamadas</th>
                <th class="py-2 pr-4 text-right font-medium">% error</th>
                <th class="py-2 pr-4 text-right font-medium">% cortadas</th>
                <th class="py-2 pr-4 text-right font-medium">% validación</th>
                <th class="py-2 text-right font-medium">
                  Tokens prom. (entrada / salida)
                </th>
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track row.app_key) {
                <tr class="border-b border-border last:border-0">
                  <td class="py-2 pr-4 font-mono text-text-primary">
                    {{ row.app_key }}
                  </td>
                  <td class="py-2 pr-4 text-right">
                    {{ row.total_calls | number }}
                  </td>
                  <td
                    class="py-2 pr-4 text-right"
                    [class.text-red-600]="row.error_rate >= alertRate"
                    [class.font-semibold]="row.error_rate >= alertRate"
                  >
                    {{ row.error_rate | number: '1.0-1' }} %
                  </td>
                  <td
                    class="py-2 pr-4 text-right"
                    [class.text-red-600]="row.truncated_rate >= alertRate"
                    [class.font-semibold]="row.truncated_rate >= alertRate"
                  >
                    {{ row.truncated_rate | number: '1.0-1' }} %
                  </td>
                  <td
                    class="py-2 pr-4 text-right"
                    [class.text-red-600]="
                      row.validation_failed_rate >= alertRate
                    "
                    [class.font-semibold]="
                      row.validation_failed_rate >= alertRate
                    "
                  >
                    {{ row.validation_failed_rate | number: '1.0-1' }} %
                  </td>
                  <td class="py-2 text-right text-text-secondary">
                    {{ row.avg_total_tokens | number }}
                    <span class="text-xs">
                      ({{ row.avg_prompt_tokens | number }} /
                      {{ row.avg_completion_tokens | number }})
                    </span>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </app-card>
  `,
})
export class AIAppHealthPanelComponent implements OnInit {
  private readonly aiEngineService = inject(AIEngineService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly alertRate = ALERT_RATE;
  readonly rows = signal<AIAppHealthRow[]>([]);
  readonly isLoading = signal(false);

  readonly range = new FormGroup({
    from: new FormControl(
      toLocalDateString(
        new Date(Date.now() - DEFAULT_DAYS * 24 * 60 * 60 * 1000),
      ),
      { nonNullable: true },
    ),
    to: new FormControl(toLocalDateString(), { nonNullable: true }),
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    const { from, to } = this.range.getRawValue();
    this.isLoading.set(true);
    this.aiEngineService
      .getAppHealth(buildAppHealthQuery(from, to))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (report) => this.rows.set(report.apps ?? []),
        error: () => {
          this.rows.set([]);
          this.toastService.error('No se pudo cargar la salud por app');
        },
      })
      .add(() => this.isLoading.set(false));
  }
}
