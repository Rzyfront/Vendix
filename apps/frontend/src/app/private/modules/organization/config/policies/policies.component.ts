import { Component, effect, inject, signal } from '@angular/core';
import {
  FormGroup,
  FormControl,
  ReactiveFormsModule,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  InputComponent,
  TextareaComponent,
  ButtonComponent,
  CardComponent,
  ToggleComponent,
  SelectorComponent,
  SelectorOption,
  SpinnerComponent,
  AlertBannerComponent,
  IconComponent,
  StickyHeaderComponent,
} from '../../../../../shared/components';
import { OrganizationSettingsService } from '../services/organization-settings.service';

@Component({
  selector: 'app-policies',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    InputComponent,
    TextareaComponent,
    ButtonComponent,
    CardComponent,
    ToggleComponent,
    SelectorComponent,
    SpinnerComponent,
    AlertBannerComponent,
    IconComponent,
    StickyHeaderComponent,
  ],
  template: `
    <div class="w-full">
      <app-sticky-header
        title="Políticas organizacionales"
        subtitle="Reglas y normativas de la organización"
        icon="file-text"
        [showBackButton]="true"
        backRoute="/admin/config"
      ></app-sticky-header>

      <div class="mt-6">
        @if (loading()) {
          <div class="flex justify-center py-12">
            <app-spinner size="lg" text="Cargando políticas..."></app-spinner>
          </div>
        } @else if (error()) {
          <app-alert-banner variant="danger" icon="alert-circle">
            {{ error() }}
            <button class="ml-3 underline font-semibold" (click)="dismissError()">Cerrar</button>
          </app-alert-banner>
        } @else {
          <app-card [responsivePadding]="true">
            <form [formGroup]="form" class="space-y-6">
              <!-- Privacy Policy -->
              <div class="border-b border-gray-200 pb-6">
                <h3 class="text-lg font-semibold mb-4 flex items-center gap-2">
                  <app-icon name="shield" size="18"></app-icon>
                  Políticas de privacidad
                </h3>

                <div class="space-y-4">
                  <app-textarea
                    label="Política de privacidad"
                    placeholder="Describe la política de privacidad de tu organización..."
                    formControlName="privacy_policy"
                    [rows]="4"
                  ></app-textarea>

                  <app-input
                    label="URL de política de privacidad"
                    type="url"
                    placeholder="https://ejemplo.com/privacidad"
                    formControlName="privacy_policy_url"
                  ></app-input>
                </div>
              </div>

              <!-- Terms & Conditions -->
              <div class="border-b border-gray-200 pb-6">
                <h3 class="text-lg font-semibold mb-4 flex items-center gap-2">
                  <app-icon name="file-check" size="18"></app-icon>
                  Términos y condiciones
                </h3>

                <div class="space-y-4">
                  <app-textarea
                    label="Términos y condiciones"
                    placeholder="Describe los términos y condiciones..."
                    formControlName="terms_conditions"
                    [rows]="4"
                  ></app-textarea>

                  <app-input
                    label="URL de términos"
                    type="url"
                    placeholder="https://ejemplo.com/terminos"
                    formControlName="terms_url"
                  ></app-input>
                </div>
              </div>

              <!-- Return Policy -->
              <div class="border-b border-gray-200 pb-6">
                <h3 class="text-lg font-semibold mb-4 flex items-center gap-2">
                  <app-icon name="refresh-cw" size="18"></app-icon>
                  Política de devoluciones
                </h3>

                <div class="space-y-4">
                  <app-textarea
                    label="Política de devoluciones"
                    placeholder="Describe la política de devoluciones..."
                    formControlName="return_policy"
                    [rows]="4"
                  ></app-textarea>

                  <app-selector
                    label="Días para devoluciones"
                    [options]="returnDaysOptions"
                    formControlName="return_window_days"
                    placeholder="Seleccionar"
                  ></app-selector>
                </div>
              </div>

              <!-- Sales Policy -->
              <div>
                <h3 class="text-lg font-semibold mb-4 flex items-center gap-2">
                  <app-icon name="shopping-cart" size="18"></app-icon>
                  Políticas de venta
                </h3>

                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <app-input
                    label="Pedido mínimo"
                    type="number"
                    placeholder="0"
                    formControlName="minimum_order_amount"
                  ></app-input>

                  <app-input
                    label="Pedido máximo"
                    type="number"
                    placeholder="999999"
                    formControlName="maximum_order_amount"
                  ></app-input>
                </div>

                <div class="mt-4 space-y-3">
                  <app-toggle
                    label="Permitir ventas sin stock"
                    description="Permite completar ventas aunque el stock sea insuficiente"
                    formControlName="allow_sales_without_stock"
                  ></app-toggle>

                  <app-toggle
                    label="Requerir confirmación para pedidos grandes"
                    description="Pedidos superiores al umbral requieren aprobación manual"
                    formControlName="require_approval_threshold"
                  ></app-toggle>
                </div>

                @if (form.get('require_approval_threshold')?.value) {
                  <div class="mt-4">
                    <app-input
                      label="Umbral de confirmación (monto)"
                      type="number"
                      placeholder="1000000"
                      formControlName="approval_threshold_amount"
                    ></app-input>
                  </div>
                }
              </div>

              <!-- Save Button -->
              <div class="flex justify-end pt-4 border-t border-gray-200">
                <app-button
                  variant="primary"
                  [loading]="saving()"
                  [disabled]="form.pristine || form.invalid"
                  (clicked)="onSave()"
                >
                  Guardar políticas
                </app-button>
              </div>
            </form>
          </app-card>
        }
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
  `],
})
export class PoliciesComponent {
  private settingsService = inject(OrganizationSettingsService);

  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  form = new FormGroup({
    privacy_policy: new FormControl('', { nonNullable: true }),
    privacy_policy_url: new FormControl('', { nonNullable: true }),
    terms_conditions: new FormControl('', { nonNullable: true }),
    terms_url: new FormControl('', { nonNullable: true }),
    return_policy: new FormControl('', { nonNullable: true }),
    return_window_days: new FormControl('30', { nonNullable: true }),
    minimum_order_amount: new FormControl(0, { nonNullable: true }),
    maximum_order_amount: new FormControl(999999, { nonNullable: true }),
    allow_sales_without_stock: new FormControl(false, { nonNullable: true }),
    require_approval_threshold: new FormControl(false, { nonNullable: true }),
    approval_threshold_amount: new FormControl(0, { nonNullable: true }),
  });

  readonly returnDaysOptions: SelectorOption[] = [
    { value: '7', label: '7 días' },
    { value: '14', label: '14 días' },
    { value: '30', label: '30 días' },
    { value: '60', label: '60 días' },
    { value: '90', label: '90 días' },
  ];

  constructor() {
    this.settingsService.getSettings().pipe(takeUntilDestroyed()).subscribe((settings) => {
      this.loading.set(this.settingsService.loading());
      this.saving.set(this.settingsService.saving());
      this.error.set(this.settingsService.error());

      if (settings) {
        const policies = (settings as any).policies || {};
        this.form.patchValue(
          {
            privacy_policy: policies.privacy_policy || '',
            privacy_policy_url: policies.privacy_policy_url || '',
            terms_conditions: policies.terms_conditions || '',
            terms_url: policies.terms_url || '',
            return_policy: policies.return_policy || '',
            return_window_days: policies.return_window_days || '30',
            minimum_order_amount: policies.minimum_order_amount || 0,
            maximum_order_amount: policies.maximum_order_amount || 999999,
            allow_sales_without_stock: policies.allow_sales_without_stock ?? false,
            require_approval_threshold: policies.require_approval_threshold ?? false,
            approval_threshold_amount: policies.approval_threshold_amount || 0,
          },
          { emitEvent: false },
        );
        this.form.markAsPristine();
      }
    });
  }

  onSave(): void {
    if (this.form.pristine || this.form.invalid || this.saving()) return;

    const policies = this.form.value;
    this.settingsService.saveSettings({ policies } as any).subscribe({
      next: () => this.form.markAsPristine(),
      error: () => {},
    });
  }

  dismissError(): void {
    this.error.set(null);
  }
}
