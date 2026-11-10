import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { AuthFacade } from '../../../../../../../core/store/auth/auth.facade';
import { DialogService, ToastService } from '../../../../../../../shared/components/index';
import { ManufacturingOrder } from '../../../interfaces';
import { ManufacturingOrdersService, ManufacturingSettingsService } from '../../../services';
import { ProductionOrdersService } from '../../../../restaurant-ops/production/services/production-orders.service';
import { ProductionSseService } from '../../../../restaurant-ops/production/services/production-sse.service';
import { OrderDetailPageComponent } from './order-detail-page.component';

/**
 * S27 / S23 (release #1134): el detalle de la orden de Planta.
 *  - al cambiar `:id` en la misma instancia, una carga anterior no pisa la actual;
 *  - la venta ligada no pide el endpoint de restaurante en una tienda sin restaurante.
 */
describe('OrderDetailPageComponent (Planta) — S27 / S23', () => {
  let params$: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let requests: Record<number, Subject<ManufacturingOrder>>;
  let restaurantGetById: jasmine.Spy;
  let isRestaurant: boolean;
  let navigate: jasmine.Spy;

  const orderOf = (id: number, extra: Partial<ManufacturingOrder> = {}) =>
    ({
      id,
      status: 'completed',
      order_id: null,
      ...extra,
    }) as unknown as ManufacturingOrder;

  const create = () => {
    const fixture = TestBed.createComponent(OrderDetailPageComponent);
    fixture.componentInstance.ngOnInit();
    return fixture.componentInstance;
  };

  beforeEach(() => {
    params$ = new BehaviorSubject(convertToParamMap({ id: '1' }));
    requests = { 1: new Subject(), 2: new Subject() };
    restaurantGetById = jasmine.createSpy('restaurantGetById').and.returnValue(of({}));
    isRestaurant = false;
    navigate = jasmine.createSpy('navigate');

    TestBed.configureTestingModule({
      providers: [
        { provide: ActivatedRoute, useValue: { paramMap: params$.asObservable() } },
        { provide: Router, useValue: { navigate } },
        {
          provide: ManufacturingOrdersService,
          useValue: {
            getById: (id: number) => requests[id].asObservable(),
            getShortages: () => of([]),
          },
        },
        {
          provide: ManufacturingSettingsService,
          useValue: { get: () => of({ lot_required: false }) },
        },
        { provide: ProductionOrdersService, useValue: { getById: restaurantGetById } },
        { provide: ProductionSseService, useValue: { listen: () => undefined } },
        { provide: AuthFacade, useValue: { isRestaurant: () => isRestaurant } },
        { provide: ToastService, useValue: { error: () => undefined, success: () => undefined } },
        { provide: DialogService, useValue: { confirm: () => Promise.resolve(false) } },
      ],
    });
  });

  it('al pasar de la orden 1 a la 2, la respuesta tardía de la 1 no pisa la 2', () => {
    const page = create();
    params$.next(convertToParamMap({ id: '2' }));

    requests[2].next(orderOf(2));
    requests[1].next(orderOf(1));

    expect(page.order()?.id).toBe(2);
    expect(page.isLoading()).toBeFalse();
  });

  it('al cambiar de orden se limpia la anterior mientras carga la nueva', () => {
    const page = create();
    requests[1].next(orderOf(1));
    expect(page.order()?.id).toBe(1);

    params$.next(convertToParamMap({ id: '2' }));
    expect(page.order()).toBeNull();
    expect(page.isLoading()).toBeTrue();

    requests[2].next(orderOf(2));
    expect(page.order()?.id).toBe(2);
  });

  it('un :id inválido vuelve a la lista sin pedir nada', () => {
    params$.next(convertToParamMap({ id: 'abc' }));
    create();
    expect(navigate).toHaveBeenCalledWith(['/admin/manufacturing/orders']);
  });

  it('S23: en una tienda sin restaurante la venta ligada no usa el endpoint de restaurante', () => {
    const page = create();
    requests[1].next(
      orderOf(1, {
        order_id: 77,
        sale_order: { id: 77, order_number: 'ORD-77', state: 'processing' },
      }),
    );
    expect(restaurantGetById).not.toHaveBeenCalled();
    expect(page.saleDetail()?.sale_order?.order_number).toBe('ORD-77');
  });

  it('S23: en una tienda de restaurante la venta ligada se lee como antes', () => {
    isRestaurant = true;
    create();
    requests[1].next(orderOf(1, { order_id: 77 }));
    expect(restaurantGetById).toHaveBeenCalledWith(1);
  });
});
