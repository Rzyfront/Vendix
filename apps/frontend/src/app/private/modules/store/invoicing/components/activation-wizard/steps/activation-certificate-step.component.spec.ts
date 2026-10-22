import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ActivationCertificateStepComponent } from './activation-certificate-step.component';

describe('ActivationCertificateStepComponent (rama inicial segun certificate_present)', () => {
  let httpMock: HttpTestingController;

  function create(config: Record<string, unknown>, provisioningStatus: string) {
    const fixture = TestBed.createComponent(ActivationCertificateStepComponent);
    fixture.componentRef.setInput('context', {
      scope: 'store',
      readOnly: false,
      readOnlyReason: null,
      legalDataComplete: true,
      axis: null,
      config,
    });
    fixture.detectChanges();
    const req = httpMock.expectOne((r) => r.url.endsWith(`/dian-config/${config['id']}/identity-documents`));
    req.flush({ data: { certificate_provisioning_status: provisioningStatus, documents: [] } });
    return fixture.componentInstance;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).overrideComponent(ActivationCertificateStepComponent, {
      set: { template: '', imports: [] },
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('fila saneada con certificate_present=true y sin certificate_s3_key abre la rama con certificado', () => {
    const cmp = create({ id: 1, certificate_present: true }, 'issued');
    expect(cmp.branch()).toBe('with_cert');
  });

  it('certificate_present=false con tramite en curso abre la rama sin certificado', () => {
    const cmp = create({ id: 2, certificate_present: false }, 'documents_submitted');
    expect(cmp.branch()).toBe('without_cert');
  });

  it('estado not_required conserva la rama con certificado', () => {
    const cmp = create({ id: 3, certificate_present: false }, 'not_required');
    expect(cmp.branch()).toBe('with_cert');
  });

  it('fila antigua sin certificate_present usa certificate_s3_key como respaldo', () => {
    const cmp = create({ id: 4, certificate_s3_key: 'k.p12' }, 'documents_pending');
    expect(cmp.branch()).toBe('with_cert');
  });
});
