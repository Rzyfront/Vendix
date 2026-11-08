import { HttpErrorResponse } from '@angular/common/http';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { throwError } from 'rxjs';
import { ToastService } from '../../../../../../shared/components/index';
import { DocumentTemplatesApiService } from '../../services/document-templates-api.service';
import { TemplatesEditorPageComponent } from './templates-editor-page.component';

describe('TemplatesEditorPageComponent · PDF base y límite del plan (P7.1)', () => {
  let api: jasmine.SpyObj<DocumentTemplatesApiService>;
  let toast: jasmine.SpyObj<ToastService>;
  let page: TemplatesEditorPageComponent;

  const pdf = () => new File(['%PDF'], 'formato.pdf', { type: 'application/pdf' });

  beforeEach(() => {
    api = jasmine.createSpyObj('DocumentTemplatesApiService', ['uploadBasePdf']);
    toast = jasmine.createSpyObj('ToastService', ['success', 'error']);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: DocumentTemplatesApiService, useValue: api },
        { provide: ToastService, useValue: toast },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map() } } },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
      ],
    });
    page = TestBed.runInInjectionContext(() => new TemplatesEditorPageComponent());
  });

  it('con el almacenamiento al tope no agrega un toast rojo encima del paywall', () => {
    api.uploadBasePdf.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 402,
            error: { error_code: 'WORKFLOW_PLAN_LIMIT_REACHED', message: 'Llegaste al límite de tu plan.' },
          }),
      ),
    );
    page.uploadBase(pdf());
    expect(api.uploadBasePdf).toHaveBeenCalledTimes(1);
    expect(page.uploading()).toBeFalse();
    expect(toast.error).not.toHaveBeenCalled();
    expect(page.problems()).toEqual([]);
  });

  it('otro rechazo de la subida sí muestra su mensaje', () => {
    api.uploadBasePdf.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: { error_code: 'DOCUMENT_TEMPLATE_INVALID', message: 'El archivo no es un PDF válido.' },
          }),
      ),
    );
    page.uploadBase(pdf());
    expect(toast.error).toHaveBeenCalledOnceWith('El archivo no es un PDF válido.');
  });
});
