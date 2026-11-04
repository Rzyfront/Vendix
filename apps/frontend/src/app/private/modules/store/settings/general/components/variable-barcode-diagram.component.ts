import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { VariableBarcodeSegment } from '../../../../../../shared/utils/variable-barcode.util';

/**
 * Pinta los 13 dígitos de una etiqueta de balanza partidos por tramo (prefijo,
 * código de producto, peso, control) con color y su rango de posiciones en
 * base 1, para que se entienda de un vistazo qué parte del código es qué.
 */
@Component({
  selector: 'app-variable-barcode-diagram',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (segments().length) {
      <div class="vb-diagram" role="img" [attr.aria-label]="ariaLabel()">
        @for (s of segments(); track s.start) {
          <div [class]="'vb-seg vb-seg--' + s.kind">
            <span class="vb-seg__digits">{{ s.digits }}</span>
            @if (showLabels()) {
              <span class="vb-seg__label">{{ s.label }}</span>
              <span class="vb-seg__pos">pos. {{ s.positions }}</span>
            }
          </div>
        }
      </div>
    }
  `,
  styles: [
    `
      .vb-diagram {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem;
      }
      .vb-seg {
        display: flex;
        flex-direction: column;
        align-items: center;
        border-radius: 0.375rem;
        padding: 0.25rem 0.375rem;
        border: 1px solid transparent;
        min-width: 1.75rem;
      }
      .vb-seg__digits {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 1rem;
        font-weight: 700;
        letter-spacing: 0.12em;
      }
      .vb-seg__label {
        font-size: 0.625rem;
        font-weight: 600;
        line-height: 1.1;
        text-align: center;
      }
      .vb-seg__pos {
        font-size: 0.5625rem;
        opacity: 0.8;
      }
      .vb-seg--prefix {
        background: var(--color-info-50);
        border-color: var(--color-info-200);
        color: var(--color-info-700);
      }
      .vb-seg--product {
        background: var(--color-primary-50);
        border-color: var(--color-primary-100);
        color: var(--color-primary);
      }
      .vb-seg--weight {
        background: var(--color-success-50);
        border-color: var(--color-success-300);
        color: var(--color-success-700);
      }
      .vb-seg--check {
        background: var(--color-surface-muted);
        border-color: var(--color-border);
        color: var(--color-text-secondary);
      }
      .vb-seg--unused {
        background: transparent;
        border-color: var(--color-border);
        border-style: dashed;
        color: var(--color-text-muted);
      }
    `,
  ],
})
export class VariableBarcodeDiagramComponent {
  readonly segments = input<VariableBarcodeSegment[]>([]);
  readonly showLabels = input(true);

  readonly ariaLabel = computed(() =>
    this.segments()
      .map((s) => `${s.label} ${s.digits} (posiciones ${s.positions})`)
      .join(', '),
  );
}
