import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ToastService } from '../../../../../../shared/components/index';
import { WorkflowTemplateSummary } from '../../interfaces/workflow-templates.interfaces';
import { WorkflowTemplatesApiService } from '../../services/workflow-templates-api.service';
import { TemplatesGalleryPageComponent } from './templates-gallery-page.component';

const TEMPLATE: WorkflowTemplateSummary = {
  key: 'pqr',
  name: 'PQR',
  category: 'Servicio al cliente',
  description: 'Peticiones, quejas y reclamos',
  icon: 'life-buoy',
  stage_count: 5,
  stages: [{ key: 'radicacion', name: 'Radicación', type: 'form' }],
};

describe('TemplatesGalleryPageComponent', () => {
  let fixture: ComponentFixture<TemplatesGalleryPageComponent>;
  let component: TemplatesGalleryPageComponent;
  let api: jasmine.SpyObj<WorkflowTemplatesApiService>;
  let toast: jasmine.SpyObj<ToastService>;
  let router: Router;

  beforeEach(async () => {
    api = jasmine.createSpyObj('WorkflowTemplatesApiService', ['list', 'activate']);
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    api.list.and.returnValue(of([TEMPLATE]));
    await TestBed.configureTestingModule({
      imports: [TemplatesGalleryPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: WorkflowTemplatesApiService, useValue: api },
        { provide: ToastService, useValue: toast },
      ],
    }).compileComponents();
    router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.resolveTo(true);
    fixture = TestBed.createComponent(TemplatesGalleryPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('carga las plantillas y las muestra filtradas', () => {
    expect(component.visible().length).toBe(1);
    component.search.set('inexistente');
    expect(component.visible().length).toBe(0);
  });

  it('activar muestra el aviso, guarda el resultado y no navega solo', () => {
    api.activate.and.returnValue(
      of({ id: 9, key: 'pqr', name: 'PQR', version: 1, source_template_key: 'pqr' }),
    );
    component.activate(TEMPLATE);
    expect(api.activate).toHaveBeenCalledWith('pqr');
    expect(toast.success).toHaveBeenCalledWith('Plantilla activada y publicada');
    expect(component.activated()?.id).toBe(9);
    expect(component.activating()).toBeNull();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('"Abrir en el editor" va al editor del flujo creado', () => {
    component.activated.set({ id: 9, key: 'pqr', name: 'PQR', version: 1, source_template_key: 'pqr' });
    component.openInEditor();
    expect(router.navigate).toHaveBeenCalledWith(['/admin/workflows', 9, 'edit']);
  });

  it('si activar falla muestra el error y no abre el aviso de éxito', () => {
    api.activate.and.returnValue(throwError(() => ({ status: 500, error: {} })));
    component.activate(TEMPLATE);
    expect(toast.error).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(component.activated()).toBeNull();
    expect(component.activating()).toBeNull();
  });
});
