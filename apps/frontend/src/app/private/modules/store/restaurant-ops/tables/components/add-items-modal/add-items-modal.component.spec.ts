import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { AddItemsModalComponent, promotionalPriceFor } from './add-items-modal.component';
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
};
const pincho = (overrides: Record<string, unknown> = {}): any => ({
  id: 4273,
  name: 'Pinchos de pollo',
  base_price: 27777.78,
  final_price: 30000,
  active_promotion: PINCHO_PROMO,
  ...overrides,
});

describe('promotionalPriceFor — precio con promo para mostrar al agregar a la mesa', () => {
  it('usa el precio promocional del backend para el producto base', () => {
    expect(promotionalPriceFor(30000, PINCHO_PROMO as any, 30000)).toBe(21000);
  });

  it('re-aplica el porcentaje sobre una variante con otro precio', () => {
    expect(promotionalPriceFor(32000, PINCHO_PROMO as any, 30000)).toBe(22400);
  });

  it('monto fijo sobre variante y nunca negativo', () => {
    const fixed = { id: 1, type: 'fixed_amount', discount_amount: 5000, promotional_price: 25000 };
    expect(promotionalPriceFor(12000, fixed as any, 30000)).toBe(7000);
    expect(promotionalPriceFor(4000, fixed as any, 30000)).toBe(0);
  });

  it('sin promo, o promo que no baja el precio, devuelve null', () => {
    expect(promotionalPriceFor(30000, null, 30000)).toBeNull();
    expect(promotionalPriceFor(30000, { id: 2, promotional_price: 30000 } as any, 30000)).toBeNull();
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

  it('muestra precio de lista y precio con promo, con la etiqueta de la promo', () => {
    const c = fixture.componentInstance;
    const row = pincho();
    expect(c.rowDisplayPrice(row)).toBe(30000);
    expect(c.rowPromoPrice(row)).toBe(21000);
    expect(c.rowPromotion(row)?.id).toBe(61);
    expect(c.promotionLabel(row)).toBe('-30% En pincho pollo');
  });

  it('el total del modal suma lo que cobrará la cuenta (con promo)', () => {
    const c = fixture.componentInstance;
    const row = pincho();
    const gaseosa: any = { id: 4310, name: 'Gaseosa 1.5 Lts', final_price: 10800, active_promotion: null };
    c.productById.set(new Map([[row.id, row], [gaseosa.id, gaseosa]]));
    c.selectedQty.set(new Map([[row.id, 2], [gaseosa.id, 1]]));
    expect(c.totalPreview()).toBe(2 * 21000 + 10800);
  });

  it('producto sin promo queda con su precio de lista', () => {
    const c = fixture.componentInstance;
    const row = pincho({ id: 4274, name: 'Pinchos de pollo - cerdo', active_promotion: null });
    expect(c.rowPromoPrice(row)).toBeNull();
    expect(c.rowChargedPrice(row)).toBe(30000);
  });
});
