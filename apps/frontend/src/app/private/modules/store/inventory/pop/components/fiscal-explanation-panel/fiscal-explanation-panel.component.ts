import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';

import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { PopFiscalExplanation } from '../../interfaces';

/**
 * CP-PURCHASE-TRANSPARENCY B.5 / B.7 — el panel que explica QUÉ se hace con el
 * IVA de la compra, POR QUÉ, y CON QUÉ BASE LEGAL.
 *
 * Nace de una petición literal del usuario: «siempre se comunique en el proceso
 * de compra en la UI y al cliente lo que se va a hacer, por qué, qué decisión se
 * va a tomar y con qué base legal … y si la persona todavía no ha configurado su
 * módulo fiscal, agrega la leyenda de que recomendamos configurar tu área
 * fiscal».
 *
 * Reglas que lo gobiernan:
 *  1. **No deriva nada.** Pinta el `fiscal_explanation` que emite el backend.
 *     Si la pantalla dedujera el predicado por su cuenta, el paso de recepción y
 *     el de confirmación podrían afirmar cosas opuestas sobre la misma compra —
 *     que es exactamente el defecto que este panel cierra.
 *  2. **Aparece también con IVA cero.** El tratamiento del impuesto es una
 *     decisión del sistema esté o no gravada la factura; esconderlo cuando el
 *     monto es 0 dejaba la única explicación fiscal del flujo sin pintar jamás.
 *  3. **Degrada limpio.** Sin explicación (respuesta vieja, fila sintetizada en
 *     el cliente) no pinta nada, en vez de inventar un texto.
 *
 * Vive bajo `pop/components` y lo consumen también las pantallas de órdenes de
 * compra: el panel pertenece al flujo de compra, no a una sola pantalla suya.
 */
@Component({
  selector: 'app-fiscal-explanation-panel',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (explanation(); as fx) {
      <section class="fx-panel" [class.fx-panel--warn]="fx.indeterminate">
        <div class="fx-head">
          <app-icon
            [name]="fx.indeterminate ? 'shield-alert' : 'receipt'"
            [size]="16"
          ></app-icon>
          <p class="fx-title">{{ title() }}</p>
          <span class="fx-badge">{{ treatmentLabel() }}</span>
        </div>

        <p class="fx-message">{{ fx.message }}</p>

        @if (fx.indeterminate) {
          <p class="fx-recommendation">
            Todavía no sabemos si tu negocio es responsable de IVA, así que el
            sistema aplica la regla más conservadora y suma el IVA al costo de
            tus productos. Te recomendamos configurar tu área fiscal para que el
            costo y el margen se calculen con tu situación real.
          </p>
        }

        @if (fx.legal_basis.length > 0) {
          <div class="fx-legal">
            <p class="fx-legal-title">Base legal</p>
            <ul class="fx-legal-list">
              @for (basis of fx.legal_basis; track basis) {
                <li>{{ basis }}</li>
              }
            </ul>
          </div>
        }

        @if (fx.cta; as cta) {
          <button
            type="button"
            class="fx-cta"
            (click)="navigateToFiscalWizard.emit(cta.route)"
          >
            {{ cta.label }}
            <app-icon name="arrow-right" [size]="14"></app-icon>
          </button>
        }
      </section>
    }
  `,
  styles: [
    `
      /* Mismo lenguaje visual que .retry-banner / .ack-hint del paso de
         confirmacion: sin app-alert-banner, solo tokens del tema. */
      .fx-panel {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 14px;
        border-radius: 14px;
        border: 1px solid var(--color-border);
        background: var(--color-surface);
      }

      .fx-panel--warn {
        border-color: #f59e0b;
        background: rgba(245, 158, 11, 0.08);
      }

      .fx-head {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .fx-title {
        font-size: 13px;
        font-weight: 700;
        color: var(--color-text-primary);
        flex: 1 1 auto;
        min-width: 0;
      }

      .fx-badge {
        flex: 0 0 auto;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        padding: 3px 8px;
        border-radius: 999px;
        border: 1px solid var(--color-border);
        background: var(--color-surface-secondary);
        color: var(--color-text-secondary);
      }

      .fx-message {
        font-size: 12px;
        line-height: 1.5;
        color: var(--color-text-secondary);
      }

      .fx-recommendation {
        font-size: 12px;
        line-height: 1.5;
        font-weight: 600;
        color: #b45309;
      }

      .fx-legal-title {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-text-muted);
        margin-bottom: 2px;
      }

      .fx-legal-list {
        margin: 0;
        padding-left: 16px;
        list-style: disc;
        font-size: 11px;
        line-height: 1.45;
        color: var(--color-text-muted);
      }

      .fx-cta {
        align-self: flex-start;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-top: 2px;
        padding: 7px 12px;
        border-radius: 10px;
        border: 1px solid var(--color-primary);
        background: transparent;
        color: var(--color-primary);
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
      }

      .fx-cta:hover {
        background: var(--color-surface-secondary);
      }
    `,
  ],
})
export class FiscalExplanationPanelComponent {
  readonly explanation = input<PopFiscalExplanation | null>(null);

  /** La ruta la manda el backend en `cta.route`; la pantalla no la inventa. */
  readonly navigateToFiscalWizard = output<string>();

  readonly title = computed<string>(() =>
    this.explanation()?.indeterminate
      ? 'No pudimos confirmar tu situación fiscal'
      : 'Tratamiento del IVA de esta compra',
  );

  readonly treatmentLabel = computed<string>(() =>
    this.explanation()?.treatment === 'deductible'
      ? 'IVA descontable'
      : 'IVA al costo',
  );
}
