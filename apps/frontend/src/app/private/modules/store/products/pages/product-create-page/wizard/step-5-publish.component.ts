import { Component, input, output, computed, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { IconComponent, BadgeComponent, AlertBannerComponent } from '../../../../../../../shared/components';

@Component({
  selector: 'app-step-5-publish',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    IconComponent,
    BadgeComponent,
    AlertBannerComponent,
  ],
  template: `
    <div class="step-container">
      <div class="step-header">
        <h2 class="step-title">Publicar</h2>
        <p class="step-description">
          Revisa la configuración y publica tu producto.
        </p>
      </div>

      <div class="publish-content">
        <!-- Resumen del producto -->
        <div class="summary-card">
          <h3 class="summary-title">Resumen</h3>
          
          <div class="summary-grid">
            <div class="summary-item">
              <span class="summary-label">Nombre</span>
              <span class="summary-value">{{ productName() || 'Sin nombre' }}</span>
            </div>
            
            <div class="summary-item">
              <span class="summary-label">Precio</span>
              <span class="summary-value price">
                {{ basePrice() | currency:currencyCode():'symbol':'1.2-2' }}
              </span>
            </div>

            <div class="summary-item">
              <span class="summary-label">Stock</span>
              <span class="summary-value">
                @if (trackInventory()) {
                  {{ stockQuantity() }} unidades
                } @else {
                  Sin seguimiento
                }
              </span>
            </div>

            <div class="summary-item">
              <span class="summary-label">Estado</span>
              <app-badge [variant]="stateBadgeVariant()">{{ stateLabel() }}</app-badge>
            </div>

            @if (hasVariants()) {
              <div class="summary-item full-width">
                <span class="summary-label">Variantes</span>
                <span class="summary-value">
                  {{ variantCount() }} variantes configuradas
                </span>
              </div>
            }

            @if (categoryNames().length > 0) {
              <div class="summary-item full-width">
                <span class="summary-label">Categorías</span>
                <span class="summary-value">{{ categoryNames().join(', ') }}</span>
              </div>
            }
          </div>
        </div>

        <!-- Validación final -->
        <div class="validation-section">
          <h3 class="section-title">Validación</h3>
          
          <div class="validation-list">
            @for (check of validationChecks(); track check.label) {
              <div class="validation-item" [class.success]="check.passed" [class.error]="!check.passed">
                <app-icon [name]="check.passed ? 'check-circle' : 'alert-circle'" [size]="16" />
                <span>{{ check.label }}</span>
              </div>
            }
          </div>
        </div>

        <!-- Errores de validación -->
        @if (validationErrors().length > 0) {
          <app-alert-banner variant="danger">
            Errores encontrados: {{ validationErrors()[0] }}
          </app-alert-banner>
        }

        <!-- Advertencias -->
        @if (warnings().length > 0) {
          <app-alert-banner variant="warning">
            Advertencias: {{ warnings()[0] }}
          </app-alert-banner>
        }

        <!-- Info de publicación -->
        <div class="publish-info">
          <app-icon name="info" [size]="16" />
          <p>
            Al hacer clic en "Publicar", el producto estará disponible según el estado
            seleccionado (Activo, Inactivo o Archivado).
          </p>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .step-container {
      padding: 1rem;
    }

    .step-header {
      margin-bottom: 1.5rem;
    }

    .step-title {
      font-size: 1.25rem;
      font-weight: 600;
      color: var(--color-text-primary);
      margin: 0 0 0.5rem 0;
    }

    .step-description {
      font-size: 0.875rem;
      color: var(--color-text-secondary);
      margin: 0;
    }

    .publish-content {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .summary-card {
      background: var(--color-surface);
      border-radius: 12px;
      border: 1px solid var(--color-border);
      padding: 1.25rem;
    }

    .summary-title {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--color-text-primary);
      margin: 0 0 1rem 0;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }

    @media (max-width: 640px) {
      .summary-grid {
        grid-template-columns: 1fr;
      }
    }

    .summary-item {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .summary-item.full-width {
      grid-column: 1 / -1;
    }

    .summary-label {
      font-size: 0.75rem;
      color: var(--color-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .summary-value {
      font-size: 0.875rem;
      color: var(--color-text-primary);
      font-weight: 500;
    }

    .summary-value.price {
      color: var(--color-primary);
      font-weight: 600;
    }

    .validation-section {
      background: var(--color-surface);
      border-radius: 12px;
      border: 1px solid var(--color-border);
      padding: 1.25rem;
    }

    .section-title {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--color-text-primary);
      margin: 0 0 1rem 0;
    }

    .validation-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .validation-item {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      border-radius: 6px;
      font-size: 0.875rem;
    }

    .validation-item.success {
      background: color-mix(in srgb, var(--color-success) 10%, transparent);
      color: var(--color-success);
    }

    .validation-item.error {
      background: color-mix(in srgb, var(--color-error) 10%, transparent);
      color: var(--color-error);
    }

    .publish-info {
      display: flex;
      gap: 0.75rem;
      padding: 1rem;
      background: var(--color-background);
      border-radius: 8px;
      border: 1px solid var(--color-border);
    }

    .publish-info app-icon {
      color: var(--color-text-secondary);
      flex-shrink: 0;
    }

    .publish-info p {
      font-size: 0.875rem;
      color: var(--color-text-secondary);
      margin: 0;
      line-height: 1.4;
    }

    @media (min-width: 768px) {
      .step-container {
        padding: 1.5rem;
      }
    }
  `]
})
export class Step5PublishComponent implements OnInit, OnDestroy {
  readonly form = input.required<FormGroup>();
  readonly categories = input<{ id: number; name: string }[]>([]);
  readonly hasVariants = input<boolean>(false);
  readonly variantCount = input<number>(0);
  readonly allStepsValid = input<boolean>(false);

  readonly validityChange = output<{ isValid: boolean; completionPercent: number; errors: string[] }>();

  readonly currencyCode = () => 'USD';

  readonly productName = computed(() => this.form().get('name')?.value || '');
  readonly basePrice = computed(() => Number(this.form().get('base_price')?.value || 0));
  readonly stockQuantity = computed(() => Number(this.form().get('stock_quantity')?.value || 0));
  readonly trackInventory = computed(() => !!this.form().get('track_inventory')?.value);
  readonly state = computed(() => this.form().get('state')?.value || 'active');

  readonly categoryNames = computed(() =>
    this.categories()
      .filter((c) => (this.form().get('category_ids')?.value as number[])?.includes(c.id))
      .map((c) => c.name)
  );

  readonly stateBadgeVariant = computed(() => {
    const s = this.state();
    if (s === 'active') return 'success';
    if (s === 'inactive') return 'warning';
    return 'neutral';
  });

  readonly stateLabel = computed(() => {
    const s = this.state();
    if (s === 'active') return 'Activo';
    if (s === 'inactive') return 'Inactivo';
    return 'Archivado';
  });

  readonly validationChecks = computed(() => [
    {
      label: 'Nombre del producto configurado',
      passed: !!this.productName(),
    },
    {
      label: 'Precio base definido',
      passed: this.basePrice() > 0,
    },
    {
      label: 'SKU configurado',
      passed: !!this.form().get('sku')?.value?.trim(),
    },
    {
      label: 'Formulario sin errores',
      passed: this.allStepsValid(),
    },
  ]);

  readonly validationErrors = computed(() => {
    const errors: string[] = [];
    const checks = this.validationChecks();
    
    if (!checks[0].passed) errors.push('El nombre del producto es requerido');
    if (!checks[1].passed) errors.push('El precio base debe ser mayor a 0');
    if (!checks[3].passed) errors.push('Hay errores en los pasos anteriores');

    return errors;
  });

  readonly warnings = computed(() => {
    const warnings: string[] = [];
    
    if (!this.form().get('sku')?.value?.trim()) {
      warnings.push('El producto no tiene SKU configurado');
    }
    
    if (!this.form().get('description')?.value?.trim()) {
      warnings.push('El producto no tiene descripción');
    }

    return warnings;
  });

  ngOnInit(): void {
    this.form().statusChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.updateValidity());

    this.updateValidity();
  }

  ngOnDestroy(): void {}

  private updateValidity(): void {
    const errors = this.validationErrors();
    const isValid = this.allStepsValid() && errors.length === 0;
    const completionPercent = isValid ? 100 : Math.round((this.validationChecks().filter((c) => c.passed).length / this.validationChecks().length) * 100);

    this.validityChange.emit({ isValid, completionPercent, errors });
  }
}
