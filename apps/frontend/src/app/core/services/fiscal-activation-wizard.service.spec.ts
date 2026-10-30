import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';

import { FiscalActivationWizardService } from './fiscal-activation-wizard.service';
import { AuthFacade } from '../store/auth/auth.facade';

describe('FiscalActivationWizardService (legal-data draft isolation)', () => {
  const LEGACY_KEY = 'vendix:fiscal-wizard-draft:store:STORE:none';

  const auth = {
    selectedAppType: signal<string | null>('STORE_ADMIN'),
    userId: signal<number | null>(1),
    userOrganization: signal<{ id: number } | null>({ id: 10 }),
    userStore: signal<{ id: number } | null>({ id: 100 }),
    fiscalStatus: signal(null),
  };
  let service: FiscalActivationWizardService;

  function signInAs(user_id: number | null, organization_id: number, store_id: number): void {
    auth.userId.set(user_id);
    auth.userOrganization.set({ id: organization_id });
    auth.userStore.set({ id: store_id });
  }

  function draftKeys(): string[] {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('vendix:fiscal-wizard-draft:')) keys.push(key);
    }
    return keys;
  }

  beforeEach(() => {
    draftKeys().forEach((key) => localStorage.removeItem(key));
    signInAs(1, 10, 100);
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthFacade, useValue: auth },
      ],
    });
    service = TestBed.inject(FiscalActivationWizardService);
  });

  afterEach(() => {
    draftKeys().forEach((key) => localStorage.removeItem(key));
  });

  it('does not restore a draft saved by another tenant', () => {
    service.saveWizardDraft({ legal_name: 'Tenant A', nit: '900000001' });

    signInAs(2, 20, 200);

    expect(service.hydrateWizardDraft()).toBeNull();
  });

  it('restores the draft for the same user, organization and store', () => {
    service.saveWizardDraft({ legal_name: 'Tenant A' });

    expect(service.hydrateWizardDraft()).toEqual({ legal_name: 'Tenant A' });
  });

  it('does not persist a draft without a known user', () => {
    signInAs(null, 10, 100);

    service.saveWizardDraft({ legal_name: 'Anonymous' });

    expect(draftKeys()).toEqual([]);
  });

  it('purges and never returns a legacy tenant-less draft', () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ legal_name: 'Platform' }));

    expect(service.hydrateWizardDraft()).toBeNull();
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });
});
