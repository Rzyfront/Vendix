import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { of } from 'rxjs';
import { OrdersListPageComponent } from './orders-list-page.component';
import {
  ManufacturingFormulasService,
  ManufacturingOrdersService,
  ManufacturingPlantsService,
} from '../../../services';
import { ProductionSseService } from '../../../../restaurant-ops/production/services/production-sse.service';
import { ToastService } from '../../../../../../../shared/components/index';

/**
 * QUI-1065 — el filtro por planta de la lista de órdenes de producción vive en
 * `?plant_id=`: sobrevive a recargas y enlaces compartidos, y al quitarlo el
 * enlace queda limpio. Los demás filtros no tocan la URL.
 */
describe('OrdersListPageComponent filtro por planta en la URL (QUI-1065)', () => {
  let component: OrdersListPageComponent;
  let orders: jasmine.SpyObj<ManufacturingOrdersService>;
  let plants: jasmine.SpyObj<ManufacturingPlantsService>;
  let router: jasmine.SpyObj<Router>;
  let route: { snapshot: { queryParamMap: ReturnType<typeof convertToParamMap> } };

  const plant = (id: number) => ({ id, name: `Planta ${id}`, is_active: true });
  const lastQuery = () => orders.listPaginated.calls.mostRecent().args[0] ?? {};

  const setup = (query: Record<string, string>, plantIds: number[]) => {
    route = { snapshot: { queryParamMap: convertToParamMap(query) } };
    plants.list.and.returnValue(of(plantIds.map(plant) as any));
    TestBed.overrideProvider(ActivatedRoute, { useValue: route });
    component = TestBed.createComponent(OrdersListPageComponent).componentInstance;
    component.ngOnInit();
  };

  beforeEach(async () => {
    orders = jasmine.createSpyObj('ManufacturingOrdersService', ['listPaginated']);
    orders.listPaginated.and.returnValue(of({ data: [], meta: { pagination: { total: 0 } } } as any));
    plants = jasmine.createSpyObj('ManufacturingPlantsService', ['list']);
    router = jasmine.createSpyObj('Router', ['navigate']);
    // La navegación de prueba actualiza el snapshot como lo haría el Router.
    router.navigate.and.callFake((_cmds: unknown, extras: any) => {
      const next: Record<string, string> = {};
      const plantId = extras?.queryParams?.plant_id;
      if (plantId != null) next['plant_id'] = String(plantId);
      route.snapshot.queryParamMap = convertToParamMap(next);
      return Promise.resolve(true);
    });

    await TestBed.configureTestingModule({
      imports: [OrdersListPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ManufacturingOrdersService, useValue: orders },
        { provide: ManufacturingFormulasService, useValue: { listProducts: () => of([]) } },
        { provide: ManufacturingPlantsService, useValue: plants },
        { provide: ProductionSseService, useValue: { listen: () => {} } },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['error', 'success']) },
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: {} },
      ],
    })
      .overrideComponent(OrdersListPageComponent, { set: { template: '', imports: [] } })
      .compileComponents();
  });

  it('al abrir el enlace con ?plant_id= la lista sale ya filtrada y el selector marcado', () => {
    setup({ plant_id: '7' }, [7, 8]);

    expect(orders.listPaginated).toHaveBeenCalledTimes(1);
    expect(lastQuery().plant_id).toBe(7);
    expect(component.plantFilter()).toBe(7);
    expect(component.filterValues['plant_id']).toBe('7');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('elegir una planta la escribe en el enlace sin apilar historial', () => {
    setup({}, [7, 8]);

    component.onFilterChange({ plant_id: '8' });

    expect(lastQuery().plant_id).toBe(8);
    expect(router.navigate).toHaveBeenCalledOnceWith([], jasmine.objectContaining({
      relativeTo: route as any,
      queryParams: { plant_id: 8 },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    }));
  });

  it('quitar la planta (Todas) o limpiar filtros deja el enlace sin filtro', () => {
    setup({ plant_id: '7' }, [7, 8]);

    component.onFilterChange({ plant_id: '' });
    expect(router.navigate).toHaveBeenCalledOnceWith([], jasmine.objectContaining({ queryParams: { plant_id: null } }));
    expect(lastQuery().plant_id).toBeUndefined();

    component.onFilterChange({ plant_id: '7' });
    router.navigate.calls.reset();
    component.clearFilters();
    expect(router.navigate).toHaveBeenCalledOnceWith([], jasmine.objectContaining({ queryParams: { plant_id: null } }));
    expect(lastQuery().plant_id).toBeUndefined();
  });

  it('los demás filtros no tocan el enlace', () => {
    setup({}, [7, 8]);

    component.onFilterChange({ status: 'draft' });

    expect(lastQuery().status).toBe('draft');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('una planta del enlace que no es de la tienda se ignora y se ven todas', () => {
    setup({ plant_id: '99' }, [7, 8]);

    expect(component.plantFilter()).toBeNull();
    expect(component.filterValues['plant_id']).toBeUndefined();
    expect(lastQuery().plant_id).toBeUndefined();
    expect(router.navigate).toHaveBeenCalledOnceWith([], jasmine.objectContaining({ queryParams: { plant_id: null } }));
  });

  it('con una sola planta (el filtro no se muestra) el enlace no deja la lista filtrada', () => {
    setup({ plant_id: '7' }, [7]);

    expect(component.plantFilter()).toBeNull();
    expect(lastQuery().plant_id).toBeUndefined();
  });

  it('un plant_id no numérico se ignora sin filtrar', () => {
    setup({ plant_id: 'abc' }, [7, 8]);

    expect(component.plantFilter()).toBeNull();
    expect(orders.listPaginated).toHaveBeenCalledTimes(1);
    expect(lastQuery().plant_id).toBeUndefined();
  });
});
