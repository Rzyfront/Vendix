import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import {
  SALE_CONFIG_EXAMPLES,
  SaleConfigExample,
  SaleConfigInput,
  buildSaleConfigExplanation,
} from '../../../../../../shared/services/pricing';

/**
 * Tarjeta que afirma en una frase qué quedó configurado para vender un
 * producto, y ofrece ejemplos por industria que precargan una configuración
 * válida.
 *
 * Existe porque tres campos sueltos —unidad de stock, escala de precio y
 * presentaciones— no le dicen a nadie qué va a pasar cuando venda. La tarjeta
 * lo dice con los números del producto que está editando, no con un texto de
 * ayuda genérico.
 *
 * El texto sale de `buildSaleConfigExplanation`, compartido con el modal de
 * compra y el POS, para que las tres superficies no puedan contradecirse.
 */
@Component({
  selector: 'app-sale-config-hint',
  standalone: true,
  imports: [CommonModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="rounded-xl border border-primary-100 bg-primary-50/60 p-3 space-y-2"
    >
      <div class="flex items-start gap-2">
        <app-icon
          name="info"
          size="14"
          class="text-primary-600 mt-0.5 shrink-0"
        ></app-icon>
        <div class="space-y-1">
          <p class="text-xs font-semibold text-primary-800">
            {{ explanation().headline }}
          </p>
          @for (line of explanation().lines; track line) {
            <p class="text-[11px] text-primary-700 leading-snug">{{ line }}</p>
          }
        </div>
      </div>

      @if (showExamples()) {
        <div class="pt-1 border-t border-primary-100/70 space-y-1.5">
          <p
            class="text-[10px] uppercase font-bold tracking-wider text-primary-700/80"
          >
            Ejemplos para empezar
          </p>
          <div class="flex flex-wrap gap-1.5">
            @for (example of examples; track example.id) {
              <button
                type="button"
                class="text-[11px] rounded-lg border border-primary-200 bg-bg px-2 py-1 text-primary-700 hover:bg-primary-100 transition-colors"
                [title]="example.description"
                (click)="exampleSelected.emit(example)"
              >
                {{ example.label }}
              </button>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class SaleConfigHintComponent {
  /** Datos ya resueltos del producto que se está editando. */
  readonly config = input.required<SaleConfigInput>();
  /** Los ejemplos solo tienen sentido mientras el producto no está definido. */
  readonly showExamples = input<boolean>(false);

  readonly exampleSelected = output<SaleConfigExample>();

  readonly examples = SALE_CONFIG_EXAMPLES;

  readonly explanation = computed(() =>
    buildSaleConfigExplanation(this.config()),
  );
}
