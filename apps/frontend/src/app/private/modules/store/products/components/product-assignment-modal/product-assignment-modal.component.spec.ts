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
  let dialog: { confirm: jasmine.Spy };
  let brandsService: {
    getProductIds: jasmine.Spy;
    assignProducts: jasmine.Spy;
    previewAssignProducts: jasmine.Spy;
  };
  let getProductsPage: jasmine.Spy;
  let getProductIds: jasmine.Spy;
  let toast: { success: jasmine.Spy; error: jasmine.Spy; warning: jasmine.Spy };

  function build(mode: 'category' | 'brand' = 'category', members: number[] = []) {
    categoriesService = {
      getProductIds: jasmine
        .createSpy('getProductIds')
        .and.returnValue(of({ product_ids: members, total: members.length })),
      assignProducts: jasmine
        .createSpy('assignProducts')
        .and.callFake((_id: number, _action: string, chunk: number[]) =>
          of({ added: chunk.length, removed: 0, unchanged: 0 }),
        ),
    };
    brandsService = {
      getProductIds: jasmine
        .createSpy('getProductIds')
        .and.returnValue(of({ product_ids: members, total: members.length })),
      assignProducts: jasmine
        .createSpy('assignProducts')
        .and.callFake((_id: number, _action: string, chunk: number[]) =>
          of({ added: 0, removed: chunk.length, unchanged: 0 }),
        ),
      previewAssignProducts: jasmine
        .createSpy('previewAssignProducts')
        .and.returnValue(of({ to_move: [] })),
    };
    getProductsPage = jasmine
      .createSpy('getProductsPage')
      .and.returnValue(of({ data: [], total: 0 }));
    getProductIds = jasmine
      .createSpy('getProductIds')
      .and.returnValue(of({ ids: [5], total: 1, capped: false }));
    dialog = { confirm: jasmine.createSpy('confirm').and.resolveTo(true) };
    toast = {
      success: jasmine.createSpy('success'),
      error: jasmine.createSpy('error'),
      warning: jasmine.createSpy('warning'),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: CategoriesService, useValue: categoriesService },
        { provide: BrandsService, useValue: brandsService },
        {
          provide: ProductsBulkEditService,
          useValue: {
            getProductsPage,
            getProductIds,
          },
        },
        { provide: ToastService, useValue: toast },
        { provide: DialogService, useValue: dialog },
      ],
    });
    TestBed.overrideComponent(ProductAssignmentModalComponent, {
      set: { template: '', imports: [] },
    });
    const fixture = TestBed.createComponent(ProductAssignmentModalComponent);
    fixture.componentRef.setInput('mode', mode);
    fixture.componentRef.setInput('entityId', 7);
    fixture.componentRef.setInput('entityName', mode === 'brand' ? 'Acme' : 'Bebidas');
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

  describe('confirmación al quitar', () => {
    it('quitados>0 y cancelar: no llama assignProducts y no cierra', async () => {
      const component = build('category', [1, 2, 3]);
      await new Promise((r) => setTimeout(r));
      (component as any).selected.set(new Set([1]));
      dialog.confirm.and.resolveTo(false);

      await component.save();

      expect(dialog.confirm).toHaveBeenCalledTimes(1);
      const msg = dialog.confirm.calls.mostRecent().args[0].message as string;
      expect(msg).toContain('Se quitarán 2 productos de la categoría «Bebidas»');
      expect(categoriesService.assignProducts).not.toHaveBeenCalled();
      expect(component.isOpen()).toBeTrue();
      expect(component.isSaving()).toBeFalse();
      expect((component as any).selected()).toEqual(new Set([1]));
    });

    it('confirmar: llama assignProducts con remove', async () => {
      const component = build('category', [1, 2, 3]);
      await new Promise((r) => setTimeout(r));
      (component as any).selected.set(new Set([1, 2]));

      await component.save();

      expect(dialog.confirm.calls.mostRecent().args[0].message).toContain(
        'Se quitará 1 producto de la categoría',
      );
      expect(categoriesService.assignProducts).toHaveBeenCalledWith(7, 'remove', [3]);
    });

    it('quitados=0 y sin movimientos: no abre diálogo', async () => {
      const component = build('category', [1]);
      await new Promise((r) => setTimeout(r));
      (component as any).selected.set(new Set([1, 2]));

      await component.save();

      expect(dialog.confirm).not.toHaveBeenCalled();
      expect(categoriesService.assignProducts).toHaveBeenCalledWith(7, 'add', [2]);
    });

    it('marca con quitados y movidos: un solo diálogo combinado', async () => {
      const component = build('brand', [1, 2]);
      await new Promise((r) => setTimeout(r));
      brandsService.previewAssignProducts.and.returnValue(
        of({ to_move: [{ brand_id: 9, brand_name: 'Otra', count: 2 }] }),
      );
      (component as any).selected.set(new Set([1, 10, 11]));

      await component.save();

      expect(dialog.confirm).toHaveBeenCalledTimes(1);
      const msg = dialog.confirm.calls.mostRecent().args[0].message as string;
      expect(msg).toContain('Se quitará 1 producto de la marca «Acme»');
      expect(msg).toContain('2 productos dejarán la marca Otra');
      expect(brandsService.assignProducts).toHaveBeenCalledWith(7, 'remove', [2]);
    });
  });

  describe('filtro sin categoría / sin marca', () => {
    it('categoría: al activarlo pide without_category=true en página 1', async () => {
      const component = build('category');
      await new Promise((r) => setTimeout(r));
      component.onPageChange(3);
      getProductsPage.calls.reset();

      component.setOnlyUnassigned(true);

      expect(getProductsPage).toHaveBeenCalledTimes(1);
      const q = getProductsPage.calls.mostRecent().args[0];
      expect(q.without_category).toBeTrue();
      expect(q.without_brand).toBeUndefined();
      expect(q.page).toBe(1);
    });

    it('marca: al activarlo pide without_brand=true en página 1', async () => {
      const component = build('brand');
      await new Promise((r) => setTimeout(r));
      getProductsPage.calls.reset();

      component.setOnlyUnassigned(true);

      const q = getProductsPage.calls.mostRecent().args[0];
      expect(q.without_brand).toBeTrue();
      expect(q.without_category).toBeUndefined();
      expect(q.page).toBe(1);
    });

    it('al desactivarlo deja de enviar el filtro', async () => {
      const component = build('category');
      await new Promise((r) => setTimeout(r));
      component.setOnlyUnassigned(true);
      getProductsPage.calls.reset();

      component.setOnlyUnassigned(false);

      const q = getProductsPage.calls.mostRecent().args[0];
      expect(q.without_category).toBeUndefined();
    });

    it('al reabrir el modal el filtro vuelve a estar desactivado', async () => {
      const component = build('category');
      await new Promise((r) => setTimeout(r));
      component.setOnlyUnassigned(true);
      expect(component.onlyUnassigned()).toBeTrue();

      component.isOpen.set(false);
      TestBed.tick();
      component.isOpen.set(true);
      TestBed.tick();

      expect(component.onlyUnassigned()).toBeFalse();
      const q = getProductsPage.calls.mostRecent().args[0];
      expect(q.without_category).toBeUndefined();
    });

    it('seleccionar todos los resultados respeta el filtro activo', async () => {
      const component = build('category');
      await new Promise((r) => setTimeout(r));
      component.setOnlyUnassigned(true);

      await component.selectAllResults();

      expect(getProductIds.calls.mostRecent().args[0].without_category).toBeTrue();
    });
  });
});
