import { TestBed } from '@angular/core/testing';
import { Observable, of } from 'rxjs';

import { ProductAssignmentModalComponent } from './product-assignment-modal.component';
import { MAX_ASSIGN_PRODUCT_IDS } from './product-assignment.types';
import { BrandsService } from '../../services/brands.service';
import { CategoriesService } from '../../services/categories.service';
import { ProductsBulkEditService } from '../../bulk-edit/products-bulk-edit.service';
import {
  DialogService,
  ToastService,
} from '../../../../../../shared/components/index';

/** Asignación masiva: el modal parte el diff en tandas de 100 ids. */
describe('ProductAssignmentModalComponent · tandas de asignación', () => {
  const ids = (n: number, from = 1) =>
    Array.from({ length: n }, (_, i) => from + i);

  let categoriesService: {
    getProductIds: jasmine.Spy;
    assignProducts: jasmine.Spy;
  };
  let toast: { success: jasmine.Spy; error: jasmine.Spy; warning: jasmine.Spy };

  function build() {
    categoriesService = {
      getProductIds: jasmine
        .createSpy('getProductIds')
        .and.returnValue(of({ product_ids: [], total: 0 })),
      assignProducts: jasmine
        .createSpy('assignProducts')
        .and.callFake((_id: number, _action: string, chunk: number[]) =>
          of({ added: chunk.length, removed: 0, unchanged: 0 }),
        ),
    };
    toast = {
      success: jasmine.createSpy('success'),
      error: jasmine.createSpy('error'),
      warning: jasmine.createSpy('warning'),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: CategoriesService, useValue: categoriesService },
        { provide: BrandsService, useValue: {} },
        {
          provide: ProductsBulkEditService,
          useValue: {
            getProductsPage: () => of({ data: [], total: 0 }),
            getProductIds: () => of({ ids: [], total: 0, capped: false }),
          },
        },
        { provide: ToastService, useValue: toast },
        { provide: DialogService, useValue: {} },
      ],
    });
    TestBed.overrideComponent(ProductAssignmentModalComponent, {
      set: { template: '', imports: [] },
    });
    const fixture = TestBed.createComponent(ProductAssignmentModalComponent);
    fixture.componentRef.setInput('mode', 'category');
    fixture.componentRef.setInput('entityId', 7);
    fixture.componentRef.setInput('entityName', 'Bebidas');
    fixture.componentInstance.isOpen.set(true);
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  it('el tope por request es 100', () => {
    expect(MAX_ASSIGN_PRODUCT_IDS).toBe(100);
  });

  it('con 250 ids hace 3 requests (100/100/50) y agrega los resultados', async () => {
    const component = build();
    await new Promise((r) => setTimeout(r));
    (component as any).selected.set(new Set(ids(250)));

    await component.save();

    const calls = categoriesService.assignProducts.calls.allArgs();
    expect(calls.map((c) => c[2].length)).toEqual([100, 100, 50]);
    expect(calls.every((c) => c[0] === 7 && c[1] === 'add')).toBeTrue();
    expect(toast.success).toHaveBeenCalledWith('250 agregados');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('ante un fallo parcial conserva lo ya aplicado y muestra el error', async () => {
    const component = build();
    await new Promise((r) => setTimeout(r));
    let n = 0;
    categoriesService.assignProducts.and.callFake(
      (_id: number, _a: string, chunk: number[]) => {
        n++;
        if (n === 2) {
          return new Observable<never>((s) => s.error(new Error('boom')));
        }
        return of({ added: chunk.length, removed: 0, unchanged: 0 });
      },
    );
    (component as any).selected.set(new Set(ids(250)));

    await component.save();

    expect(categoriesService.assignProducts.calls.count()).toBe(2);
    expect(toast.success).toHaveBeenCalledWith('100 agregados');
    expect(toast.error).toHaveBeenCalled();
  });
});
