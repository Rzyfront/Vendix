import { EnvironmentInjector, createEnvironmentInjector } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Route, Routes } from '@angular/router';

import { orgInvoicingRoutes } from '../../../../organization/invoicing/invoicing.routes';
import { DianConfigApiService } from '../../../../../../shared/services/dian';
import { invoicingRoutes } from '../../invoicing.routes';
import { ActivationWizardComponent } from './activation-wizard.component';

function indexOfPath(routes: Routes, path: string): number {
  return routes.findIndex((r) => r.path === path);
}

describe('activation wizard routes', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
  });

  describe('store routes', () => {
    it('resolves "activation" to ActivationWizardComponent', async () => {
      const route = invoicingRoutes.find((r) => r.path === 'activation') as Route;
      expect(route).toBeDefined();
      expect(await (route.loadComponent as () => Promise<unknown>)()).toBe(ActivationWizardComponent);
    });

    it('declares "activation" before the tabs shell ("")', () => {
      const activation = indexOfPath(invoicingRoutes, 'activation');
      const shell = indexOfPath(invoicingRoutes, '');
      expect(activation).toBeGreaterThan(-1);
      expect(shell).toBeGreaterThan(-1);
      expect(activation).toBeLessThan(shell);
    });
  });

  describe('organization routes', () => {
    it('resolves "activation" to ActivationWizardComponent', async () => {
      const route = orgInvoicingRoutes.find((r) => r.path === 'activation') as Route;
      expect(route).toBeDefined();
      expect(await (route.loadComponent as () => Promise<unknown>)()).toBe(ActivationWizardComponent);
    });

    it('declares "activation" before the "" wrapper', () => {
      const activation = indexOfPath(orgInvoicingRoutes, 'activation');
      const wrapper = indexOfPath(orgInvoicingRoutes, '');
      expect(activation).toBeGreaterThan(-1);
      expect(wrapper).toBeGreaterThan(-1);
      expect(activation).toBeLessThan(wrapper);
    });

    it('provides a DianConfigApiService pointing at the organization rail', () => {
      const route = orgInvoicingRoutes.find((r) => r.path === 'activation') as Route;
      const injector = createEnvironmentInjector(
        route.providers ?? [],
        TestBed.inject(EnvironmentInjector),
      );
      const api = injector.get(DianConfigApiService);
      const http = TestBed.inject(HttpTestingController);
      api.getFiscalReadiness().subscribe();
      const req = http.expectOne((r) => r.url.includes('/organization/invoicing/dian-config/fiscal-readiness'));
      expect(req.request.method).toBe('GET');
      req.flush({});
      http.verify();
    });

    it('store (root) DianConfigApiService keeps the store rail', () => {
      const api = TestBed.inject(DianConfigApiService);
      const http = TestBed.inject(HttpTestingController);
      api.getFiscalReadiness().subscribe();
      const req = http.expectOne((r) => r.url.includes('/store/invoicing/dian-config/fiscal-readiness'));
      expect(req.request.method).toBe('GET');
      req.flush({});
      http.verify();
    });
  });
});
