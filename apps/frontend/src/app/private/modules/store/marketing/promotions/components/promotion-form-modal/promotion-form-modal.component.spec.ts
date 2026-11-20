import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { PromotionFormModalComponent } from './promotion-form-modal.component';
import { ProductsService } from '../../../../products/services/products.service';
import { CategoriesService } from '../../../../products/services/categories.service';
import { Promotion } from '../../interfaces/promotion.interface';
import { StoreSettingsFacade } from '../../../../../../../core/store/store-settings/store-settings.facade';

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
        {
          provide: StoreSettingsFacade,
          useValue: { timezone: signal('America/Bogota') },
        },
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

  describe('fecha y hora opcional', () => {
    const submit = (component: PromotionFormModalComponent): any => {
      let sent: any;
      component.save.subscribe((dto) => (sent = dto));
      component.onSubmit();
      return sent;
    };

    it('sin hora envía solo YYYY-MM-DD (día completo de la tienda)', () => {
      const component = open({
        ...savedPromo([]),
        start_date: '2026-11-20T00:00:00.000Z',
        end_date: '2026-11-21T23:59:59.999Z',
      });
      expect(component.form.get('start_time')?.value).toBe('');
      expect(component.form.get('end_time')?.value).toBe('');
      const dto = submit(component);
      expect(dto.start_date).toBe('2026-11-20');
      expect(dto.end_date).toBe('2026-11-21');
      expect('start_time' in dto).toBeFalse();
      expect('end_time' in dto).toBeFalse();
    });

    it('con hora envía ISO con el offset de la zona de la tienda', () => {
      const component = open(savedPromo([]));
      component.form.patchValue({
        start_date: '2026-11-20',
        start_time: '08:30',
        end_date: '2026-11-21',
        end_time: '15:00',
      });
      const dto = submit(component);
      expect(dto.start_date).toBe('2026-11-20T08:30:00-05:00');
      expect(dto.end_date).toBe('2026-11-21T15:00:00-05:00');
    });

    it('al editar carga la hora guardada (reloj de la tienda)', () => {
      const component = open({
        ...savedPromo([]),
        end_date: '2026-11-21T15:00:00.000Z',
      });
      expect(component.form.get('end_date')?.value).toBe('2026-11-21');
      expect(component.form.get('end_time')?.value).toBe('15:00');
    });

    it('una promo antigua con fin a medianoche se lee como todo el día', () => {
      const component = open({
        ...savedPromo([]),
        end_date: '2026-11-21T00:00:00.000Z',
      });
      expect(component.form.get('end_date')?.value).toBe('2026-11-21');
      expect(component.form.get('end_time')?.value).toBe('');
    });
  });
});
