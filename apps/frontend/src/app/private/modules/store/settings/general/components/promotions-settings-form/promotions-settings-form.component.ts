import {
  Component,
  ChangeDetectionStrategy,
  computed,
  effect,
  input,
  output,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, FormGroup, FormControl, Validators } from '@angular/forms';
import { SettingToggleComponent } from '../../../../../../../shared/components/setting-toggle/setting-toggle.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../../shared/components/selector/selector.component';
import {
  AlertBannerComponent,
} from '../../../../../../../shared/components/index';
import { PromotionsSettings } from '../../../../../../../core/models/store-settings.interface';

const DEFAULTS: PromotionsSettings = {
  evaluation_strategy: 'winner_takes_all',
  max_combined_discount_percentage: 50,
  allow_order_promo_stacking: true,
  exclude_tier_priced_lines: false,
  enable_high_conversion_ui: true,
};

@Component({
  selector: 'app-promotions-settings-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    SettingToggleComponent,
    SelectorComponent,
    AlertBannerComponent,
  ],
  template: `
    <form [formGroup]="form" class="space-y-6">
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-semibold text-text-primary mb-1">
            Modo de Evaluación de Promociones
          </label>
          <p class="text-xs text-text-secondary mb-1">
            Elige <strong>un solo modo</strong> — seleccionar otro modo reemplaza el actual.
          </p>
          <p class="text-xs text-text-secondary mb-3">
            Define cómo el motor resuelve el caso en que un carrito califica para varias promociones simultáneamente.
          </p>
          <app-selector
            [options]="strategyOptions"
            formControlName="evaluation_strategy"
            placeholder="Selecciona el modo de evaluación"
          />
        </div>

        @if (form.get('evaluation_strategy')?.value === 'winner_takes_all') {
          <app-alert-banner
            variant="info"
            title="Mejor Promoción (Winner-Takes-All)"
            message="El sistema evalúa todas las promociones activas y aplica únicamente la de mayor prioridad o mayor beneficio económico para el cliente, descartando las demás."
          />
        } @else {
          <app-alert-banner
            variant="success"
            title="Acumulación Inteligente (Stacking Groups)"
            message="Permite que promociones de diferentes productos o categorías se apliquen concurrentemente en el mismo pedido, protegiendo tus márgenes mediante límites globales configurables."
          />
        }

        <div class="pt-4 border-t border-border/40">
          <label class="block text-sm font-semibold text-text-primary mb-1">
            Límite Máximo de Descuento Combinado (%)
          </label>
          <p class="text-xs text-text-secondary mb-2">
            Porcentaje máximo que las promociones pueden descontar sobre el subtotal del pedido.
          </p>
          <div class="flex items-center gap-3">
            <input
              type="number"
              min="1"
              max="90"
              formControlName="max_combined_discount_percentage"
              class="w-24 px-3 py-2 text-sm rounded-md border border-border bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
            <span class="text-sm font-medium text-text-secondary">% máximo de descuento</span>
          </div>
        </div>

        <div class="pt-4 border-t border-border/40 space-y-4">
          <app-setting-toggle
            label="Acumular promociones de orden con productos"
            description="Permite que una promoción global de carrito se sume sobre el subtotal restante después de aplicar promociones específicas por producto."
            formControlName="allow_order_promo_stacking"
          />

          <app-setting-toggle
            label="Excluir productos con tarifas mayoristas / multitarifa"
            description="Evita que productos que ya tienen precios por volumen o listas mayoristas reciban descuentos adicionales por promociones."
            formControlName="exclude_tier_priced_lines"
          />

          <app-setting-toggle
            label="Experiencia de Alta Conversión (Visualización Promocional)"
            description="Muestra badges dinámicos, escaleras de descuento por volumen y avisos de progreso en tienda online y POS para incentivar mayores compras."
            formControlName="enable_high_conversion_ui"
          />
        </div>
      </div>
    </form>
  `,
})
export class PromotionsSettingsForm {
  readonly settings = input.required<PromotionsSettings | undefined>();
  readonly settingsLoaded = input<boolean>(false);
  readonly settingsChange = output<PromotionsSettings>();

  readonly strategyOptions: SelectorOption[] = [
    {
      value: 'winner_takes_all',
      label: 'Mejor Promoción Única — Winner-Takes-All',
    },
    {
      value: 'stacking_groups',
      label: 'Acumulación por Categorías — Stacking Groups',
    },
  ];

  form = new FormGroup({
    evaluation_strategy: new FormControl<'winner_takes_all' | 'stacking_groups'>(
      'winner_takes_all',
    ),
    max_combined_discount_percentage: new FormControl<number>(50, [
      Validators.min(1),
      Validators.max(90),
    ]),
    allow_order_promo_stacking: new FormControl<boolean>(true),
    exclude_tier_priced_lines: new FormControl<boolean>(false),
    enable_high_conversion_ui: new FormControl<boolean>(true),
  });

  constructor() {
    effect(() => {
      const current = this.settings() || DEFAULTS;
      this.form.patchValue(
        {
          evaluation_strategy: current.evaluation_strategy ?? 'winner_takes_all',
          max_combined_discount_percentage:
            current.max_combined_discount_percentage ?? 50,
          allow_order_promo_stacking:
            current.allow_order_promo_stacking !== false,
          exclude_tier_priced_lines:
            current.exclude_tier_priced_lines === true,
          enable_high_conversion_ui:
            current.enable_high_conversion_ui !== false,
        },
        { emitEvent: false },
      );
    });

    this.form.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        const raw = this.form.getRawValue();
        this.settingsChange.emit({
          evaluation_strategy: raw.evaluation_strategy ?? 'winner_takes_all',
          max_combined_discount_percentage: Number(
            raw.max_combined_discount_percentage ?? 50,
          ),
          allow_order_promo_stacking: raw.allow_order_promo_stacking ?? true,
          exclude_tier_priced_lines: raw.exclude_tier_priced_lines ?? false,
          enable_high_conversion_ui: raw.enable_high_conversion_ui ?? true,
        });
      });
  }
}
