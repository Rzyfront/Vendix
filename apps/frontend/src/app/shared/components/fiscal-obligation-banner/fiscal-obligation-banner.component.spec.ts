import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideRouter } from '@angular/router';

import { FiscalObligationBannerComponent } from './fiscal-obligation-banner.component';
import { AuthFacade } from '../../../core/store/auth/auth.facade';
import { FiscalArea } from '../../../core/models/fiscal-status.model';

describe('FiscalObligationBannerComponent CTAs', () => {
  const pending = signal<FiscalArea[]>([]);
  const authStub = {
    pendingFiscalObligations: pending,
    userSettings: signal<any>(null),
    updateUserSettings: jasmine.createSpy('updateUserSettings'),
  };

  async function render(areas: FiscalArea[]) {
    pending.set(areas);
    const fixture = TestBed.createComponent(FiscalObligationBannerComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    const links = Array.from(
      fixture.nativeElement.querySelectorAll('a.fiscal-banner__cta'),
    ) as HTMLAnchorElement[];
    return links.map((a) => a.getAttribute('href'));
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: AuthFacade, useValue: authStub },
      ],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('con invoicing pendiente el CTA principal va al asistente de activación', async () => {
    const hrefs = await render(['invoicing']);
    expect(hrefs).toEqual(['/admin/invoicing/activation']);
  });

  it('con invoicing y payroll aparece además el CTA secundario al wizard fiscal', async () => {
    const hrefs = await render(['invoicing', 'payroll']);
    expect(hrefs[0]).toBe('/admin/invoicing/activation');
    expect(hrefs[1]).toBe('/admin/fiscal/wizard?areas=payroll');
    expect(hrefs.length).toBe(2);
  });

  it('sin invoicing el CTA va al wizard fiscal con las áreas pendientes', async () => {
    const hrefs = await render(['payroll']);
    expect(hrefs).toEqual(['/admin/fiscal/wizard?areas=payroll']);
  });
});
