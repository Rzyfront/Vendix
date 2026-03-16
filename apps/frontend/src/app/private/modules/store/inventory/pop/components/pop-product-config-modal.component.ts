import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  SimpleChanges,
  signal,
  computed,
  effect,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ScrollableTabsComponent, ScrollableTab } from '../../../../../../shared/components/scrollable-tabs/scrollable-tabs.component';
import { SettingToggleComponent } from '../../../../../../shared/components/setting-toggle/setting-toggle.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import {
  PopProduct,
  PopProductVariant,
  LotInfo,
} from '../interfaces/pop-cart.interface';

export interface PopProductConfigResult {
  variant?: PopProductVariant;
  variants?: PopProductVariant[];
  lot_info?: LotInfo;
  quantity: number;
  unit_cost: number;
  pricing_type?: 'unit' | 'weight';
}

@Component({
  selector: 'app-pop-product-config-modal',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ModalComponent,
    ScrollableTabsComponent,
    SettingToggleComponent,
    IconComponent,
    ButtonComponent,
    InputComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      title="Configurar producto"
      [subtitle]="product?.name"
      size="sm"
      (closed)="onClose()"
      (cancel)="onClose()"
    >
      <!-- Tabs -->
      <div class="flex flex-col gap-4">
        <app-scrollable-tabs
          [tabs]="tabItems()"
          [activeTab]="activeTab()"
          size="sm"
          (tabChange)="activeTab.set($event)"
        ></app-scrollable-tabs>

        <!-- Tab: General -->
        @if (activeTab() === 'general') {
          <div class="flex flex-col gap-4">
            <!-- Product info card -->
            <div class="flex items-center gap-3 p-3 rounded-xl bg-muted/30 border border-border/50">
              <div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <app-icon name="package" [size]="20" class="text-primary"></app-icon>
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-text-primary truncate">{{ product?.name }}</p>
                <div class="flex items-center gap-3 mt-0.5">
                  @if (product?.code) {
                    <span class="text-xs text-text-muted font-mono">SKU: {{ product?.code }}</span>
                  }
                  <span class="text-xs font-semibold text-text-primary">
                    Costo: {{ formatCurrency(+(product?.cost || product?.cost_price || 0)) }}
                  </span>
                </div>
              </div>
            </div>

            <!-- Pricing type selector -->
            <div>
              <label class="block text-sm font-medium text-text-primary mb-2">Unidad de medida</label>
              <div class="flex gap-2">
                <button
                  class="flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-all"
                  [class]="selectedPricingType() === 'unit'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-surface text-text-secondary hover:border-primary/50'"
                  (click)="selectedPricingType.set('unit')"
                >
                  Unidad
                </button>
                <button
                  class="flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-all"
                  [class]="selectedPricingType() === 'weight'
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-surface text-text-secondary hover:border-primary/50'"
                  (click)="selectedPricingType.set('weight')"
                >
                  Peso (kg)
                </button>
              </div>
            </div>

            <!-- Toggles -->
            <app-setting-toggle
              label="Gestionar variantes"
              [description]="productHasVariants ? 'Seleccionar variantes del producto para la orden' : 'Este producto no tiene variantes'"
              [ngModel]="hasVariantsToggle()"
              [disabled]="!productHasVariants"
              (changed)="hasVariantsToggle.set($event)"
            ></app-setting-toggle>

            <app-setting-toggle
              label="Gestionar lote"
              description="Asignar número de lote y fechas de fabricación/vencimiento"
              [ngModel]="requiresLotToggle()"
              (changed)="requiresLotToggle.set($event)"
            ></app-setting-toggle>
          </div>
        }

        <!-- Tab: Variantes -->
        @if (activeTab() === 'variants') {
          <div class="flex flex-col gap-2">
            <!-- Select all / counter (only in multi-select mode) -->
            @if (!isEditing) {
              <div class="flex items-center justify-between px-1 pb-1">
                <span class="text-xs text-text-muted">
                  {{ selectedVariantIds.size }} de {{ product?.product_variants?.length }} seleccionadas
                </span>
                <button
                  class="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                  (click)="toggleSelectAllVariants()"
                >
                  {{ allVariantsSelected ? 'Deseleccionar todas' : 'Seleccionar todas' }}
                </button>
              </div>
            }

            @for (variant of product?.product_variants; track variant.id) {
              <button
                class="w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left"
                [class]="isVariantSelected(variant.id)
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border hover:border-primary hover:bg-primary/5 cursor-pointer active:scale-[0.98]'"
                (click)="onToggleVariant(variant)"
              >
                <!-- Checkbox indicator (multi) or Radio (single/edit) -->
                <div
                  class="w-5 h-5 rounded flex-shrink-0 flex items-center justify-center border transition-all"
                  [class]="isVariantSelected(variant.id)
                    ? 'bg-primary border-primary'
                    : 'border-border bg-surface'"
                  [class.rounded-full]="isEditing"
                  [class.rounded-md]="!isEditing"
                >
                  @if (isVariantSelected(variant.id)) {
                    <app-icon name="check" [size]="12" class="text-white"></app-icon>
                  }
                </div>

                <div class="w-10 h-10 rounded-lg bg-muted/50 flex-shrink-0 flex items-center justify-center">
                  <app-icon name="layers" [size]="18" class="text-text-muted"></app-icon>
                </div>
                <div class="flex-1 min-w-0">
                  <p class="font-medium text-sm text-text-primary truncate">
                    {{ getVariantLabel(variant) }}
                  </p>
                  <p class="text-xs text-text-muted font-mono mt-0.5">
                    SKU: {{ variant.sku }}
                  </p>
                </div>
                <div class="flex flex-col items-end flex-shrink-0">
                  @if (variant.cost_price) {
                    <span class="font-bold text-sm text-text-primary">
                      {{ formatCurrency(+variant.cost_price) }}
                    </span>
                  }
                  @if (variant.stock_quantity !== undefined) {
                    <span class="text-xs mt-0.5"
                      [class]="variant.stock_quantity <= 5 ? 'text-warning' : 'text-text-muted'"
                    >
                      {{ variant.stock_quantity }} disp.
                    </span>
                  }
                </div>
              </button>
            }

            @if (!product?.product_variants?.length) {
              <p class="text-sm text-text-muted text-center py-4">
                Este producto no tiene variantes configuradas.
              </p>
            }
          </div>
        }

        <!-- Tab: Lote -->
        @if (activeTab() === 'lot') {
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-text-primary mb-1.5">
                Número de lote
              </label>
              <app-input
                type="text"
                size="sm"
                placeholder="Ej: LOTE-2026-001"
                [(ngModel)]="lotBatchNumber"
              ></app-input>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-sm font-medium text-text-primary mb-1.5">
                  Fecha de fabricación
                </label>
                <app-input
                  type="date"
                  size="sm"
                  [(ngModel)]="lotManufacturingDate"
                ></app-input>
              </div>
              <div>
                <label class="block text-sm font-medium text-text-primary mb-1.5">
                  Fecha de vencimiento
                </label>
                <app-input
                  type="date"
                  size="sm"
                  [(ngModel)]="lotExpirationDate"
                ></app-input>
              </div>
            </div>

            <p class="text-xs text-text-muted">
              Estos datos se enviarán al proveedor con la orden de compra.
            </p>
          </div>
        }
      </div>

      <!-- Footer -->
      <div slot="footer" class="flex items-center justify-end gap-3">
        <app-button
          variant="outline"
          size="sm"
          (clicked)="onClose()"
        >
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          size="sm"
          (clicked)="onConfirm()"
          [disabled]="!canConfirm()"
        >
          {{ confirmLabel }}
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [`
    :host { display: contents; }
  `],
})
export class PopProductConfigModalComponent implements OnChanges {
  @Input() isOpen = false;
  @Input() product: PopProduct | null = null;
  @Input() initialVariant: PopProductVariant | null = null;
  @Input() initialLotInfo: LotInfo | null = null;
  @Input() initialPricingType: 'unit' | 'weight' = 'unit';
  @Input() isEditing = false;
  @Output() confirmed = new EventEmitter<PopProductConfigResult>();
  @Output() closed = new EventEmitter<void>();

  // Tab state
  activeTab = signal<string>('general');
  hasVariantsToggle = signal(false);
  requiresLotToggle = signal(false);
  selectedPricingType = signal<'unit' | 'weight'>('unit');

  // Multi-variant selection (for adding new items)
  selectedVariantIds = new Set<number>();

  // Lot fields
  lotBatchNumber = '';
  lotManufacturingDate = '';
  lotExpirationDate = '';

  private currencyService: CurrencyFormatService;

  tabItems = computed<ScrollableTab[]>(() => {
    const tabs: ScrollableTab[] = [{ id: 'general', label: 'General', icon: 'settings' }];
    if (this.hasVariantsToggle()) tabs.push({ id: 'variants', label: 'Variantes', icon: 'layers' });
    if (this.requiresLotToggle()) tabs.push({ id: 'lot', label: 'Lote', icon: 'package' });
    return tabs;
  });

  constructor(currencyService: CurrencyFormatService) {
    this.currencyService = currencyService;

    // Redirect to 'general' if the active tab was removed
    effect(() => {
      const tabs = this.tabItems();
      const current = this.activeTab();
      if (!tabs.find(t => t.id === current)) {
        this.activeTab.set('general');
      }
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.resetState();
    }
  }

  get productHasVariants(): boolean {
    return !!this.product?.product_variants?.length;
  }

  get allVariantsSelected(): boolean {
    return !!this.product?.product_variants?.length
      && this.selectedVariantIds.size === this.product.product_variants.length;
  }

  get confirmLabel(): string {
    if (!this.isEditing && this.hasVariantsToggle() && this.selectedVariantIds.size > 1) {
      return `Agregar ${this.selectedVariantIds.size} variantes`;
    }
    return 'Confirmar';
  }

  getVariantLabel(variant: PopProductVariant): string {
    if (variant.name) return variant.name;
    if (variant.attributes) {
      const attrs = variant.attributes;
      return Object.values(attrs)
        .filter((v) => typeof v === 'string' || typeof v === 'number')
        .join(' / ') || variant.sku;
    }
    return variant.sku;
  }

  formatCurrency(amount: number): string {
    return this.currencyService.format(amount || 0);
  }

  isVariantSelected(variantId: number): boolean {
    return this.selectedVariantIds.has(variantId);
  }

  onToggleVariant(variant: PopProductVariant): void {
    if (this.isEditing) {
      // Single-select when editing an existing cart item
      this.selectedVariantIds.clear();
      this.selectedVariantIds.add(variant.id);
    } else {
      // Multi-select when adding new
      if (this.selectedVariantIds.has(variant.id)) {
        this.selectedVariantIds.delete(variant.id);
      } else {
        this.selectedVariantIds.add(variant.id);
      }
    }
    // Trigger change detection by reassigning the Set
    this.selectedVariantIds = new Set(this.selectedVariantIds);
  }

  toggleSelectAllVariants(): void {
    if (this.allVariantsSelected) {
      this.selectedVariantIds = new Set();
    } else {
      this.selectedVariantIds = new Set(
        this.product?.product_variants?.map(v => v.id) || []
      );
    }
  }

  canConfirm(): boolean {
    if (this.hasVariantsToggle() && this.selectedVariantIds.size === 0) return false;
    return true;
  }

  onConfirm(): void {
    if (!this.canConfirm()) return;

    const lotInfo = this.buildLotInfo();
    const pricingType = this.selectedPricingType();

    if (this.hasVariantsToggle() && this.product?.product_variants) {
      const selectedVariants = this.product.product_variants.filter(
        v => this.selectedVariantIds.has(v.id)
      );

      if (this.isEditing) {
        // Edit mode: single variant result
        const variant = selectedVariants[0];
        this.confirmed.emit({
          variant,
          quantity: 1,
          unit_cost: variant?.cost_price
            ? Number(variant.cost_price)
            : Number(this.product?.cost || this.product?.cost_price || 0),
          pricing_type: pricingType,
          lot_info: lotInfo,
        });
      } else {
        // Add mode: emit with variants array
        this.confirmed.emit({
          variants: selectedVariants,
          quantity: 1,
          unit_cost: Number(this.product?.cost || this.product?.cost_price || 0),
          pricing_type: pricingType,
          lot_info: lotInfo,
        });
      }
    } else {
      // No variant selection
      this.confirmed.emit({
        quantity: 1,
        unit_cost: Number(this.product?.cost || this.product?.cost_price || 0),
        pricing_type: pricingType,
        lot_info: lotInfo,
      });
    }

    this.isOpen = false;
  }

  onClose(): void {
    this.isOpen = false;
    this.closed.emit();
  }

  private buildLotInfo(): LotInfo | undefined {
    if (!this.requiresLotToggle()) return undefined;
    if (!this.lotBatchNumber && !this.lotManufacturingDate && !this.lotExpirationDate) return undefined;

    return {
      batch_number: this.lotBatchNumber || undefined,
      manufacturing_date: this.lotManufacturingDate
        ? new Date(this.lotManufacturingDate)
        : undefined,
      expiration_date: this.lotExpirationDate
        ? new Date(this.lotExpirationDate)
        : undefined,
    };
  }

  private resetState(): void {
    this.activeTab.set('general');

    // Pre-fill pricing type
    this.selectedPricingType.set(this.initialPricingType || this.product?.pricing_type || 'unit');

    // Pre-fill variant toggle and selection
    if (this.initialVariant) {
      this.hasVariantsToggle.set(true);
      this.selectedVariantIds = new Set([this.initialVariant.id]);
    } else if (this.productHasVariants) {
      this.hasVariantsToggle.set(true);
      this.selectedVariantIds = new Set();
    } else {
      this.hasVariantsToggle.set(false);
      this.selectedVariantIds = new Set();
    }

    // Pre-fill lot toggle and fields
    if (this.initialLotInfo) {
      this.requiresLotToggle.set(true);
      this.lotBatchNumber = this.initialLotInfo.batch_number || '';
      this.lotManufacturingDate = this.initialLotInfo.manufacturing_date
        ? new Date(this.initialLotInfo.manufacturing_date).toISOString().split('T')[0]
        : '';
      this.lotExpirationDate = this.initialLotInfo.expiration_date
        ? new Date(this.initialLotInfo.expiration_date).toISOString().split('T')[0]
        : '';
    } else if (this.product?.requires_batch_tracking) {
      this.requiresLotToggle.set(true);
      this.lotBatchNumber = '';
      this.lotManufacturingDate = '';
      this.lotExpirationDate = '';
    } else {
      this.requiresLotToggle.set(false);
      this.lotBatchNumber = '';
      this.lotManufacturingDate = '';
      this.lotExpirationDate = '';
    }
  }
}
