import { Component, input, output, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, FormArray, FormControl, ReactiveFormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SettingToggleComponent, IconComponent } from '../../../../../../../shared/components';
import { ProductUtils } from '../../../utils/product.utils';

interface VariantAttribute {
  name: string;
  values: string[];
}

interface GeneratedVariant {
  id?: number;
  sku: string;
  name: string;
  price: number;
  cost_price: number;
  profit_margin: number;
  is_on_sale: boolean;
  sale_price: number;
  stock: number;
  attributes: Record<string, string>;
  image_url?: string;
  image_file?: File;
  image_id?: number;
  track_inventory_override?: boolean;
}

@Component({
  selector: 'app-step-4-variants',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    SettingToggleComponent,
    IconComponent,
  ],
  template: `
    <div class="step-container">
      <div class="step-header">
        <h2 class="step-title">Variantes</h2>
        <p class="step-description">
          Crea variantes de tu producto (tallas, colores, etc.).
        </p>
      </div>

      <div class="variants-content">
        <!-- Toggle variantes -->
        <div class="variants-toggle">
          <app-setting-toggle
            [formControl]="hasVariantsToggle"
            label="Este producto tiene variantes"
            description="Activa para crear múltiples versiones del mismo producto"
          />
        </div>

        @if (hasVariantsToggle.value) {
          <div class="variants-section animate-slide">
            <!-- Atributos -->
            <div class="attributes-section">
              <h3 class="section-title">Atributos</h3>
              
              <div class="attributes-list">
                @for (attr of variantAttributes(); track $index; let i = $index) {
                  <div class="attribute-row">
                    <div class="attribute-inputs">
                      <input
                        type="text"
                        class="attr-name-input"
                        placeholder="Nombre (ej: Talla)"
                        [value]="attr.name"
                        (blur)="onAttributeNameBlur(i, $event)"
                      />
                      <div class="attr-values">
                        @for (value of attr.values; track $index; let j = $index) {
                          <span class="attr-value-chip">
                            {{ value }}
                            <button
                              type="button"
                              class="chip-remove"
                              (click)="removeAttributeValue(i, j)"
                            >
                              <app-icon name="x" [size]="12" />
                            </button>
                          </span>
                        }
                        <input
                          type="text"
                          class="attr-value-input"
                          placeholder="Agregar valor..."
                          (keydown.enter)="addAttributeValue(i, $event)"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      class="btn-remove-attr"
                      (click)="removeAttribute(i)"
                      aria-label="Eliminar atributo"
                    >
                      <app-icon name="trash-2" [size]="16" />
                    </button>
                  </div>
                }
              </div>

              <button
                type="button"
                class="btn-add-attribute"
                (click)="addAttribute()"
              >
                <app-icon name="plus" [size]="16" />
                Agregar atributo
              </button>

              @if (previewVariantCount() > 0) {
                <div class="preview-info">
                  <app-icon name="info" [size]="14" />
                  <span>Se generarán {{ previewVariantCount() }} variantes</span>
                </div>
              }
            </div>

            <!-- Lista de variantes generadas -->
            @if (generatedVariants().length > 0) {
              <div class="variants-list">
                <div class="variants-list-header">
                  <h3 class="section-title">Variantes ({{ generatedVariants().length }})</h3>
                  <button
                    type="button"
                    class="btn-apply-base"
                    (click)="applyBasePriceToAll()"
                  >
                    Aplicar precio base a todas
                  </button>
                </div>

                @for (variant of generatedVariants(); track $index; let i = $index) {
                  <div class="variant-card" [class.expanded]="expandedIndex() === i">
                    <div class="variant-header" (click)="toggleExpand(i)">
                      <div class="variant-info">
                        <span class="variant-name">{{ variant.name }}</span>
                        <span class="variant-sku">{{ variant.sku || 'Sin SKU' }}</span>
                      </div>
                      <div class="variant-price">
                        {{ variant.price | currency:'USD':'symbol':'1.2-2' }}
                      </div>
                      <app-icon
                        [name]="expandedIndex() === i ? 'chevron-up' : 'chevron-down'"
                        [size]="16"
                      />
                    </div>

                    @if (expandedIndex() === i) {
                      <div class="variant-details animate-slide">
                        <div class="variant-form">
                          <div class="form-row">
                            <div class="form-field">
                              <label>SKU</label>
                              <input
                                type="text"
                                class="variant-input"
                                placeholder="SKU de la variante"
                                [value]="variant.sku"
                                (input)="updateVariantSku(i, $any($event.target).value)"
                              />
                            </div>
                            <div class="form-field">
                              <label>Precio</label>
                              <input
                                type="number"
                                class="variant-input"
                                [value]="variant.price"
                                (input)="updateVariantPrice(i, +$any($event.target).value)"
                              />
                            </div>
                          </div>

                          <div class="form-row">
                            <div class="form-field">
                              <label>Costo</label>
                              <input
                                type="number"
                                class="variant-input"
                                [value]="variant.cost_price"
                                (input)="updateVariantCost(i, +$any($event.target).value)"
                              />
                            </div>
                            <div class="form-field">
                              <label>Margen (%)</label>
                              <input
                                type="number"
                                class="variant-input"
                                [value]="variant.profit_margin"
                                (input)="updateVariantMargin(i, +$any($event.target).value)"
                              />
                            </div>
                          </div>

                          @if (trackInventory()) {
                            <div class="form-row">
                              <div class="form-field">
                                <label>Stock</label>
                                <input
                                  type="number"
                                  class="variant-input"
                                  [value]="variant.stock"
                                  (input)="updateVariantStock(i, +$any($event.target).value)"
                                />
                              </div>
                              <div class="track-inventory-override">
                                <app-setting-toggle
                                  [formControl]="$any(hasVariantsToggle)"
                                >Seguir inventario</app-setting-toggle>
                              </div>
                            </div>
                          }

                          <div class="variant-actions">
                            <button
                              type="button"
                              class="btn-remove-variant"
                              (click)="removeVariant(i)"
                            >
                              <app-icon name="trash-2" [size]="14" />
                              Eliminar variante
                            </button>
                          </div>
                        </div>
                      </div>
                    }
                  </div>
                }
              </div>
            }
          </div>
        } @else {
          <div class="no-variants-info">
            <app-icon name="package" [size]="48" />
            <h4>Sin variantes</h4>
            <p>
              Este producto se creará como un producto simple sin variantes.
              Puedes agregar variantes más tarde editando el producto.
            </p>
          </div>
        }
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

    .variants-content {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .variants-toggle {
      padding: 1rem;
      background: var(--color-surface);
      border-radius: 8px;
      border: 1px solid var(--color-border);
    }

    .variants-section {
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .animate-slide {
      animation: slideDown 0.2s ease-out;
    }

    @keyframes slideDown {
      from {
        opacity: 0;
        transform: translateY(-8px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .attributes-section {
      background: var(--color-surface);
      border-radius: 12px;
      border: 1px solid var(--color-border);
      padding: 1rem;
    }

    .section-title {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--color-text-primary);
      margin: 0 0 1rem 0;
    }

    .attributes-list {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .attribute-row {
      display: flex;
      gap: 0.75rem;
      align-items: flex-start;
    }

    .attribute-inputs {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .attr-name-input {
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--color-border);
      border-radius: 6px;
      font-size: 0.875rem;
      background: var(--color-background);
      color: var(--color-text-primary);
    }

    .attr-name-input:focus {
      outline: none;
      border-color: var(--color-primary);
    }

    .attr-values {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }

    .attr-value-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.25rem 0.5rem;
      background: var(--color-primary);
      color: white;
      border-radius: 4px;
      font-size: 0.75rem;
    }

    .chip-remove {
      display: flex;
      align-items: center;
      justify-content: center;
      background: none;
      border: none;
      color: white;
      cursor: pointer;
      padding: 0;
      opacity: 0.7;
    }

    .chip-remove:hover {
      opacity: 1;
    }

    .attr-value-input {
      padding: 0.25rem 0.5rem;
      border: 1px dashed var(--color-border);
      border-radius: 4px;
      font-size: 0.75rem;
      background: transparent;
      color: var(--color-text-primary);
      min-width: 100px;
    }

    .attr-value-input:focus {
      outline: none;
      border-color: var(--color-primary);
      border-style: solid;
    }

    .btn-remove-attr {
      padding: 0.5rem;
      background: none;
      border: 1px solid var(--color-border);
      border-radius: 6px;
      color: var(--color-text-secondary);
      cursor: pointer;
    }

    .btn-remove-attr:hover {
      background: var(--color-error);
      border-color: var(--color-error);
      color: white;
    }

    .btn-add-attribute {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      background: none;
      border: 1px dashed var(--color-border);
      border-radius: 6px;
      color: var(--color-primary);
      font-size: 0.875rem;
      cursor: pointer;
      margin-top: 0.5rem;
    }

    .btn-add-attribute:hover {
      background: color-mix(in srgb, var(--color-primary) 10%, transparent);
      border-style: solid;
    }

    .preview-info {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: 0.75rem;
      padding: 0.5rem 0.75rem;
      background: color-mix(in srgb, var(--color-primary) 10%, transparent);
      border-radius: 6px;
      font-size: 0.75rem;
      color: var(--color-primary);
    }

    .variants-list {
      background: var(--color-surface);
      border-radius: 12px;
      border: 1px solid var(--color-border);
      padding: 1rem;
    }

    .variants-list-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
    }

    .btn-apply-base {
      padding: 0.375rem 0.75rem;
      background: var(--color-primary);
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 0.75rem;
      cursor: pointer;
    }

    .btn-apply-base:hover {
      opacity: 0.9;
    }

    .variant-card {
      border: 1px solid var(--color-border);
      border-radius: 8px;
      margin-bottom: 0.5rem;
      overflow: hidden;
    }

    .variant-card.expanded {
      border-color: var(--color-primary);
    }

    .variant-header {
      display: flex;
      align-items: center;
      gap: 1rem;
      padding: 0.75rem;
      background: var(--color-background);
      cursor: pointer;
    }

    .variant-info {
      flex: 1;
    }

    .variant-name {
      font-size: 0.875rem;
      font-weight: 500;
      color: var(--color-text-primary);
      display: block;
    }

    .variant-sku {
      font-size: 0.75rem;
      color: var(--color-text-secondary);
    }

    .variant-price {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--color-primary);
    }

    .variant-details {
      padding: 1rem;
      background: var(--color-surface);
    }

    .variant-form {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }

    @media (max-width: 640px) {
      .form-row {
        grid-template-columns: 1fr;
      }
    }

    .variant-actions {
      display: flex;
      justify-content: flex-end;
      padding-top: 0.5rem;
      border-top: 1px solid var(--color-border);
    }

    .btn-remove-variant {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.375rem 0.75rem;
      background: none;
      border: 1px solid var(--color-error);
      border-radius: 4px;
      color: var(--color-error);
      font-size: 0.75rem;
      cursor: pointer;
    }

    .btn-remove-variant:hover {
      background: var(--color-error);
      color: white;
    }

    .no-variants-info {
      text-align: center;
      padding: 3rem 1rem;
      background: var(--color-surface);
      border-radius: 12px;
      border: 1px solid var(--color-border);
    }

    .no-variants-info app-icon {
      color: var(--color-text-secondary);
      margin-bottom: 1rem;
    }

    .no-variants-info h4 {
      font-size: 1rem;
      font-weight: 600;
      color: var(--color-text-primary);
      margin: 0 0 0.5rem 0;
    }

    .no-variants-info p {
      font-size: 0.875rem;
      color: var(--color-text-secondary);
      margin: 0;
      max-width: 400px;
      margin: 0 auto;
    }

    .track-inventory-override {
      display: flex;
      align-items: center;
    }

    @media (min-width: 768px) {
      .step-container {
        padding: 1.5rem;
      }
    }
  `]
})
export class Step4VariantsComponent implements OnInit, OnDestroy {
  readonly form = input.required<FormGroup>();
  readonly basePrice = input<number>(0);
  readonly baseSku = input<string>('');
  readonly trackInventory = input<boolean>(true);

  readonly validityChange = output<{ isValid: boolean; completionPercent: number; errors: string[] }>();

  readonly variantAttributes = signal<VariantAttribute[]>([]);
  readonly generatedVariants = signal<GeneratedVariant[]>([]);
  readonly expandedIndex = signal<number | null>(null);
  readonly removedVariantKeys = signal<Set<string>>(new Set());

  // FormControl for the toggle (since hasVariants is not a FormControl)
  hasVariantsToggle = new FormControl(false);
  private _hasVariants = signal(false);

  readonly previewVariantCount = computed(() => {
    const validAttributes = this.variantAttributes().filter(
      (attr) => attr.name && attr.values.length > 0
    );
    if (validAttributes.length === 0) return 0;
    return validAttributes.reduce(
      (total, attr) => total * attr.values.length,
      1
    );
  });

  ngOnInit(): void {
    this.updateValidity();
  }

  ngOnDestroy(): void {}

  setHasVariants(value: boolean): void {
    this._hasVariants.set(value);
    if (value && this.variantAttributes().length === 0) {
      this.variantAttributes.set([{ name: '', values: [] }]);
    }
    this.updateValidity();
  }

  onAttributeNameBlur(index: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = input.value.trim();
    
    this.variantAttributes.update((attrs) => {
      const updated = [...attrs];
      if (updated[index]) {
        updated[index] = { ...updated[index], name: value };
      }
      return updated;
    });

    if (value && this.variantAttributes()[index].values.length > 0) {
      this.reconcileVariants();
    }
    this.updateValidity();
  }

  addAttribute(): void {
    this.variantAttributes.update((attrs) => [...attrs, { name: '', values: [] }]);
  }

  removeAttribute(index: number): void {
    const attr = this.variantAttributes()[index];
    if (attr.name && attr.values.length > 0) {
      // Track removed combinations
      const removed = new Set(this.removedVariantKeys());
      const combos = this.cartesian(
        this.variantAttributes()
          .filter((_, i) => i !== index)
          .map((a) => a.values)
      );
      combos.forEach((combo) => {
        const key = ProductUtils.getVariantKey(
          Object.fromEntries(
            this.variantAttributes()
              .filter((_, i) => i !== index)
              .map((a, j) => [a.name, combo[j]])
          )
        );
        removed.add(key);
      });
      this.removedVariantKeys.set(removed);
    }
    
    this.variantAttributes.update((attrs) => attrs.filter((_, i) => i !== index));
    this.reconcileVariants();
    this.updateValidity();
  }

  addAttributeValue(attrIndex: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = input.value.trim();
    if (!value) return;

    this.variantAttributes.update((attrs) => {
      const updated = [...attrs];
      if (!updated[attrIndex].values.includes(value)) {
        updated[attrIndex] = {
          ...updated[attrIndex],
          values: [...updated[attrIndex].values, value],
        };
      }
      return updated;
    });

    input.value = '';
    this.reconcileVariants();
    this.updateValidity();
  }

  removeAttributeValue(attrIndex: number, valueIndex: number): void {
    this.variantAttributes.update((attrs) => {
      const updated = [...attrs];
      updated[attrIndex] = {
        ...updated[attrIndex],
        values: updated[attrIndex].values.filter((_, i) => i !== valueIndex),
      };
      return updated;
    });
    this.reconcileVariants();
    this.updateValidity();
  }

  toggleExpand(index: number): void {
    this.expandedIndex.update((current) => (current === index ? null : index));
  }

  updateVariantSku(index: number, sku: string): void {
    this.generatedVariants.update((variants) => {
      const updated = [...variants];
      updated[index] = { ...updated[index], sku };
      return updated;
    });
    this.updateValidity();
  }

  updateVariantPrice(index: number, price: number): void {
    this.generatedVariants.update((variants) => {
      const updated = [...variants];
      updated[index] = { ...updated[index], price };
      return updated;
    });
    this.updateValidity();
  }

  updateVariantCost(index: number, cost: number): void {
    this.generatedVariants.update((variants) => {
      const updated = [...variants];
      updated[index] = { ...updated[index], cost_price: cost };
      return updated;
    });
    this.updateValidity();
  }

  updateVariantMargin(index: number, margin: number): void {
    this.generatedVariants.update((variants) => {
      const updated = [...variants];
      updated[index] = { ...updated[index], profit_margin: margin };
      return updated;
    });
    this.updateValidity();
  }

  updateVariantStock(index: number, stock: number): void {
    this.generatedVariants.update((variants) => {
      const updated = [...variants];
      updated[index] = { ...updated[index], stock };
      return updated;
    });
    this.updateValidity();
  }

  updateVariantTrackInventory(index: number, track: boolean): void {
    this.generatedVariants.update((variants) => {
      const updated = [...variants];
      updated[index] = { ...updated[index], track_inventory_override: track };
      return updated;
    });
    this.updateValidity();
  }

  removeVariant(index: number): void {
    const variant = this.generatedVariants()[index];
    if (variant?.attributes && Object.keys(variant.attributes).length > 0) {
      const removed = new Set(this.removedVariantKeys());
      removed.add(ProductUtils.getVariantKey(variant.attributes));
      this.removedVariantKeys.set(removed);
    }
    
    this.generatedVariants.update((variants) => variants.filter((_, i) => i !== index));
    this.expandedIndex.set(null);
    this.updateValidity();
  }

  applyBasePriceToAll(): void {
    const basePrice = this.basePrice();
    const baseSku = this.baseSku();
    
    this.generatedVariants.update((variants) =>
      variants.map((v, i) => {
        const skuSuffix = `-${Object.values(v.attributes).map((val: string) => val.substring(0, 3).toUpperCase()).join('-')}`;
        return {
          ...v,
          price: basePrice,
          sku: baseSku ? `${baseSku}${skuSuffix}` : v.sku,
        };
      })
    );
    this.updateValidity();
  }

  private reconcileVariants(): void {
    const validAttributes = this.variantAttributes().filter(
      (attr) => attr.name && attr.values.length > 0
    );

    if (validAttributes.length === 0) {
      this.generatedVariants.set([]);
      return;
    }

    const basePrice = this.basePrice();
    const baseSku = this.baseSku();

    const existingMap = new Map<string, GeneratedVariant>();
    for (const v of this.generatedVariants()) {
      const key = ProductUtils.getVariantKey(v.attributes);
      existingMap.set(key, v);
    }

    const newVariants: GeneratedVariant[] = [];
    const combinations = this.cartesian(validAttributes.map((a) => a.values));

    for (const combo of combinations) {
      const attributes: Record<string, string> = {};
      let nameSuffix = '';
      let skuSuffix = '';

      validAttributes.forEach((attr, index) => {
        const value = combo[index];
        attributes[attr.name] = value;
        nameSuffix += ` ${value}`;
        skuSuffix += `-${value.toUpperCase().substring(0, 3)}`;
      });

      const key = ProductUtils.getVariantKey(attributes);

      if (this.removedVariantKeys().has(key)) continue;

      const existing = existingMap.get(key);
      if (existing) {
        newVariants.push(existing);
      } else {
        newVariants.push({
          name: `Variant${nameSuffix}`,
          sku: baseSku ? `${baseSku}${skuSuffix}` : '',
          price: basePrice,
          cost_price: 0,
          profit_margin: 0,
          is_on_sale: false,
          sale_price: 0,
          stock: 0,
          attributes,
        });
      }
    }

    this.generatedVariants.set(newVariants);
  }

  private cartesian(args: any[][]): any[] {
    const r: any[] = [];
    const max = args.length - 1;
    const helper = (arr: any[], i: number) => {
      for (let j = 0, l = args[i].length; j < l; j++) {
        const a = arr.slice(0);
        a.push(args[i][j]);
        if (i == max) r.push(a);
        else helper(a, i + 1);
      }
    };
    if (args.length > 0) helper([], 0);
    return r;
  }

  private updateValidity(): void {
    const errors: string[] = [];
    const variants = this.generatedVariants();

    if (this._hasVariants() && variants.length === 0) {
      errors.push('Agrega atributos con valores para crear variantes');
    }

    if (variants.length > 0) {
      const skus = variants.map((v) => v.sku?.trim()).filter((s) => s);
      if (new Set(skus).size !== skus.length) {
        errors.push('Hay SKUs duplicados entre las variantes');
      }

      const emptySkuVariants = variants.filter((v) => !v.sku?.trim());
      if (emptySkuVariants.length > 0) {
        errors.push(`${emptySkuVariants.length} variante(s) sin SKU`);
      }
    }

    const isValid = errors.length === 0;
    const completionPercent = this._hasVariants()
      ? Math.min(100, Math.round((variants.length / 3) * 100))
      : 100;

    this.validityChange.emit({ isValid, completionPercent, errors });
  }
}
