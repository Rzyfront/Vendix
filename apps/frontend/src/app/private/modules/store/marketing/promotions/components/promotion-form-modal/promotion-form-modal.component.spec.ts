import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { PromotionFormModalComponent } from './promotion-form-modal.component';
import { ProductsService } from '../../../../products/services/products.service';
import { CategoriesService } from '../../../../products/services/categories.service';
import { Promotion } from '../../interfaces/promotion.interface';

describe('PromotionFormModalComponent — días de la semana al editar', () => {
  let fixture: ComponentFixture<PromotionFormModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PromotionFormModalComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: ProductsService,
          useValue: {
            getProducts: () => of({ data: [] }),
            getProductById: () => of(null),
          },
        },
        { provide: CategoriesService, useValue: { getCategories: () => of([]) } },
      ],
    })
      .overrideComponent(PromotionFormModalComponent, {
        set: { template: '', imports: [] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(PromotionFormModalComponent);
  });

  afterEach(() => fixture.destroy());

  function open(promotion: Partial<Promotion> | null): PromotionFormModalComponent {
    fixture.componentRef.setInput('promotion', promotion as Promotion | null);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  const savedPromo = (active_weekdays: number[]): Partial<Promotion> => ({
    id: 7,
    name: 'Martes y jueves',
    type: 'percentage',
    value: 10,
    scope: 'order',
    start_date: '2026-11-01',
    active_weekdays,
  });

  it('marca solo los días guardados al abrir una promo existente', () => {
    const component = open(savedPromo([2, 4]));
    const marked = component.weekdays
      .filter((d) => component.isDaySelected(d.value))
      .map((d) => d.value);
    expect(marked).toEqual([2, 4]);
    expect(component.weekdaysHint()).toContain('martes y jueves');
  });

  it('enciende el preset «Fin de semana» cuando la promo guardada es sábado y domingo', () => {
    const component = open(savedPromo([0, 6]));
    expect(component.isPresetActive([0, 6])).toBeTrue();
    expect(component.isPresetActive([])).toBeFalse();
    expect(component.isDaySelected(1)).toBeFalse();
  });

  it('una promo sin restricción muestra los 7 días y el preset «Todos»', () => {
    const component = open(savedPromo([]));
    expect(component.weekdays.every((d) => component.isDaySelected(d.value))).toBeTrue();
    expect(component.isPresetActive([])).toBeTrue();
  });

  it('al cambiar de la promo editada a una nueva no arrastra los días anteriores', () => {
    const component = open(savedPromo([3]));
    expect(component.isPresetActive([3])).toBeTrue();
    open(null);
    expect(component.isPresetActive([])).toBeTrue();
    expect(component.form.get('active_weekdays')?.value).toEqual([]);
  });

  it('tocar un día sobre la promo cargada parte de los días guardados', () => {
    const component = open(savedPromo([2, 4]));
    component.toggleWeekday(5);
    expect(component.form.get('active_weekdays')?.value).toEqual([2, 4, 5]);
  });
});
