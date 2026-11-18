import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import { SupportDocumentsPageComponent } from './support-documents-page.component';
import { FiscalRequirementsService } from '../../../../../../shared/services/fiscal-requirements.service';

describe('SupportDocumentsPageComponent — deep link ?document=<id> (QUI-684)', () => {
  const setup = (params: Record<string, string>) => {
    const router = { navigate: jasmine.createSpy('navigate').and.resolveTo(true) };
    const route = { snapshot: { queryParamMap: convertToParamMap(params) } };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: Router, useValue: router },
        { provide: ActivatedRoute, useValue: route },
        { provide: Store, useValue: { select: () => of(false), dispatch: jasmine.createSpy('dispatch') } },
        { provide: FiscalRequirementsService, useValue: {} },
      ],
    });
    // Los hijos no se prueban aquí: solo el estado de la página.
    TestBed.overrideComponent(SupportDocumentsPageComponent, { set: { imports: [], template: '' } });
    const page = TestBed.createComponent(SupportDocumentsPageComponent).componentInstance;
    return { page, router, route };
  };

  it('?document=5 abre el detalle con el id 5 y limpia el parámetro por el Router', () => {
    const { page, router, route } = setup({ document: '5' });

    expect(page.isDetailModalOpen()).toBeTrue();
    expect(page.detailDocumentId()).toBe(5);
    expect(router.navigate).toHaveBeenCalledWith(
      [],
      jasmine.objectContaining({
        relativeTo: route,
        queryParams: { document: null },
        queryParamsHandling: 'merge',
        replaceUrl: true,
      }),
    );
  });

  it('sin el parámetro no abre nada ni navega', () => {
    const { page, router } = setup({});

    expect(page.isDetailModalOpen()).toBeFalse();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('un valor no numérico no abre el detalle pero sí limpia la URL', () => {
    const { page, router } = setup({ document: 'abc' });

    expect(page.isDetailModalOpen()).toBeFalse();
    expect(router.navigate).toHaveBeenCalled();
  });
});
