import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import {
  AddItemsModalComponent,
  estimatePromotionDiscounts,
} from './add-items-modal.component';
import { ProductsService } from '../../../../products/services/products.service';
import { TablesService } from '../../services/tables.service';
import { ToastService } from '../../../../../../../shared/components/index';

// Pinchos de pollo (Pollo Árabe): 30.000 con INC 8 % incluido, promo 30 %.
const PINCHO_PROMO = {
  id: 61,
  name: '-30% En pincho pollo',
  type: 'percentage',
  discount_percentage: 30,
  promotional_price: 21000,
  badge_label: '-30%',
  max_discount_amount: null,
  min_purchase_amount: null,
};
const CAPPED_PROMO = { ...PINCHO_PROMO, id: 62, max_discount_amount: 9000 };
const FIXED_PROMO = {
  id: 63,
  name: '$5.000 OFF',
  type: 'fixed_amount',
  discount_amount: 5000,
  promotional_price: 25000,
  max_discount_amount: null,
  min_purchase_amount: null,
};
const MIN_PURCHASE_PROMO = { ...PINCHO_PROMO, id: 64, min_purchase_amount: 100000 };

const pincho = (overrides: Record<string, unknown> = {}): any => ({
  id: 4273,
  name: 'Pinchos de pollo',
  base_price: 27777.78,
  final_price: 30000,
  active_promotion: PINCHO_PROMO,
  ...overrides,
});

describe('estimatePromotionDiscounts — misma regla que el motor (total del alcance)', () => {
  const line = (promo: unknown, gross = 60000, key = 1): any => ({ key, gross, promo });

  it('monto fijo: se descuenta UNA vez, no por unidad', () => {
    expect(estimatePromotionDiscounts([line(FIXED_PROMO)]).get(1)).toBe(5000);
  });

  it('porcentaje con tope: el tope es del alcance completo', () => {
    expect(estimatePromotionDiscounts([line(CAPPED_PROMO)]).get(1)).toBe(9000);
  });

  it('porcentaje sin tope: proporcional al total', () => {
    expect(estimatePromotionDiscounts([line(PINCHO_PROMO)]).get(1)).toBe(18000);
  });

  it('dos productos de la misma promo comparten un solo monto fijo', () => {
    const discounts = estimatePromotionDiscounts([
      line(FIXED_PROMO, 30000, 1),
      line(FIXED_PROMO, 10000, 2),
    ]);
    expect(discounts.get(1)).toBe(3750);
    expect(discounts.get(2)).toBe(1250);
  });

  it('compra mínima no alcanzada: sin descuento; alcanzada con lo que ya hay en la cuenta: sí', () => {
    expect(estimatePromotionDiscounts([line(MIN_PURCHASE_PROMO)]).size).toBe(0);
    const withAccount = estimatePromotionDiscounts(
      [line(MIN_PURCHASE_PROMO)],
      [{ product_id: 9, list_total: 40000, has_discount: false }],
    );
    expect(withAccount.get(1)).toBe(18000);
  });

  it('monto fijo ya consumido por una línea de la cuenta: agregar más no descuenta de nuevo', () => {
    const discounts = estimatePromotionDiscounts(
      [line(FIXED_PROMO, 30000)],
      [{ product_id: 4273, list_total: 30000, has_discount: true }],
      () => FIXED_PROMO as any,
    );
    expect(discounts.size).toBe(0);
  });

  it('tope parcialmente consumido en la cuenta: solo el descuento adicional', () => {
    // Tope 9.000; la cuenta ya tiene 20.000 (6.000 de descuento) → quedan 3.000.
    const discounts = estimatePromotionDiscounts(
      [line(CAPPED_PROMO, 30000)],
      [{ product_id: 4273, list_total: 20000, has_discount: true }],
      () => CAPPED_PROMO as any,
    );
    expect(discounts.get(1)).toBe(3000);
  });

  it('cuenta con descuentos de productos desconocidos: monto fijo/tope no se estiman; porcentaje simple sí', () => {
    const account = [{ product_id: 999, list_total: 30000, has_discount: true }];
    expect(estimatePromotionDiscounts([line(FIXED_PROMO)], account).size).toBe(0);
    expect(estimatePromotionDiscounts([line(CAPPED_PROMO)], account).size).toBe(0);
    expect(estimatePromotionDiscounts([line(PINCHO_PROMO)], account).get(1)).toBe(18000);
  });

  it('sin reglas informadas por el backend o promo por cantidad: no se estima', () => {
    const legacy = { id: 70, type: 'percentage', discount_percentage: 30, promotional_price: 21000 };
    const tiered = { ...PINCHO_PROMO, id: 71, is_quantity_tiered: true };
    expect(estimatePromotionDiscounts([line(legacy)]).size).toBe(0);
    expect(estimatePromotionDiscounts([line(tiered)]).size).toBe(0);
    expect(estimatePromotionDiscounts([line(null)]).size).toBe(0);
  });
});

describe('AddItemsModalComponent — precio con promo y total', () => {
  let fixture: ComponentFixture<AddItemsModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AddItemsModalComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ProductsService, useValue: { getProducts: () => of({ data: [] }) } },
        { provide: TablesService, useValue: {} },
        { provide: ToastService, useValue: { warning: () => {}, error: () => {} } },
      ],
    })
      .overrideComponent(AddItemsModalComponent, { set: { template: '', imports: [] } })
      .compileComponents();
    fixture = TestBed.createComponent(AddItemsModalComponent);
  });

  afterEach(() => fixture.destroy());

  const select = (row: any, qty: number): AddItemsModalComponent => {
    const c = fixture.componentInstance;
    c.productById.set(new Map([[row.id, row]]));
    c.selectedQty.set(new Map([[row.id, qty]]));
    return c;
  };

  it('muestra precio de lista y precio con promo, con la etiqueta de la promo', () => {
    const c = fixture.componentInstance;
    const row = pincho();
    expect(c.rowDisplayPrice(row)).toBe(30000);
    expect(c.rowPromoPrice(row)).toBe(21000);
    expect(c.rowPromotion(row)?.id).toBe(61);
    expect(c.promotionLabel(row)).toBe('-30% En pincho pollo');
  });

  it('promo 30 % sin tope, 2 unidades de 30.000 → 42.000 (más un producto sin promo)', () => {
    const c = fixture.componentInstance;
    const row = pincho();
    const gaseosa: any = { id: 4310, name: 'Gaseosa 1.5 Lts', final_price: 10800, active_promotion: null };
    c.productById.set(new Map([[row.id, row], [gaseosa.id, gaseosa]]));
    c.selectedQty.set(new Map([[row.id, 2]]));
    expect(c.totalPreview()).toBe(42000);
    c.selectedQty.set(new Map([[row.id, 2], [gaseosa.id, 1]]));
    expect(c.totalPreview()).toBe(42000 + 10800);
  });

  it('promo de monto fijo 5.000, 2 unidades de 30.000 → 55.000 (no 50.000)', () => {
    const row = pincho({ active_promotion: FIXED_PROMO });
    const c = select(row, 2);
    expect(c.totalPreview()).toBe(55000);
    // El precio de la fila cuenta la misma historia que el total.
    expect(c.rowPromoPrice(row)).toBe(27500);
  });

  it('promo 30 % con tope 9.000, 2 unidades de 30.000 → 51.000 (no 42.000)', () => {
    const row = pincho({ active_promotion: CAPPED_PROMO });
    const c = select(row, 2);
    expect(c.totalPreview()).toBe(51000);
    expect(c.rowPromoPrice(row)).toBe(25500);
  });

  it('compra mínima no alcanzada → sin promo ni precio promocional en el selector', () => {
    const row = pincho({ active_promotion: MIN_PURCHASE_PROMO });
    const c = select(row, 2);
    expect(c.rowPromotion(row)).toBeNull();
    expect(c.rowPromoPrice(row)).toBeNull();
    expect(c.rowChargedPrice(row)).toBe(30000);
    expect(c.totalPreview()).toBe(60000);
  });

  it('compra mínima alcanzada con la selección → la promo aparece', () => {
    const row = pincho({ active_promotion: MIN_PURCHASE_PROMO });
    const c = select(row, 4);
    expect(c.rowPromoPrice(row)).toBe(21000);
    expect(c.totalPreview()).toBe(84000);
  });

  it('la cuenta ya consumió el monto fijo → agregar otra unidad cobra el precio de lista', () => {
    const row = pincho({ active_promotion: FIXED_PROMO });
    fixture.componentRef.setInput('accountLines', [
      { product_id: row.id, list_total: 30000, has_discount: true },
    ]);
    const c = select(row, 1);
    expect(c.rowPromotion(row)).toBeNull();
    expect(c.totalPreview()).toBe(30000);
  });

  it('variante más cara: el tope no se sobreestima', () => {
    const variant: any = { id: 9, final_price: 40000 };
    const row = pincho({ active_promotion: CAPPED_PROMO, product_variants: [variant] });
    const c = fixture.componentInstance;
    // 30 % de 40.000 serían 12.000, pero el tope es 9.000.
    expect(c.variantPromoPrice(variant, row)).toBe(31000);
  });

  it('variante de una promo sin reglas informadas o por cantidad: no pinta promo', () => {
    const variant: any = { id: 9, final_price: 40000 };
    const c = fixture.componentInstance;
    const legacy = { id: 70, type: 'percentage', discount_percentage: 30, promotional_price: 21000 };
    const tiered = { ...PINCHO_PROMO, id: 71, is_quantity_tiered: true };
    expect(c.variantPromoPrice(variant, pincho({ active_promotion: legacy }))).toBeNull();
    expect(c.variantPromoPrice(variant, pincho({ active_promotion: tiered }))).toBeNull();
  });

  it('producto sin promo queda con su precio de lista', () => {
    const c = fixture.componentInstance;
    const row = pincho({ id: 4274, name: 'Pinchos de pollo - cerdo', active_promotion: null });
    expect(c.rowPromoPrice(row)).toBeNull();
    expect(c.rowChargedPrice(row)).toBe(30000);
  });
});
