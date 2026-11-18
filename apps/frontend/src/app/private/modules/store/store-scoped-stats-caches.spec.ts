import { Type, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { Observable } from 'rxjs';

import { environment } from '../../../../environments/environment';
import { AuthFacade } from '../../../core/store/auth/auth.facade';
import { StoreContextService } from '../../../core/services/store-context.service';
import { AiScanJobService } from '../../../core/services/ai-scan-job.service';
import { resetStoreScopedCaches } from '../../../core/utils/store-scoped-cache';
import { DispatchNotesService } from './dispatch-notes/services/dispatch-notes.service';
import { StoreRolesService } from './settings/roles/services/store-roles.service';
import { PlanillasRutasService } from './planillas-rutas/services/planillas-rutas.service';
import { TransfersService } from './inventory/transfers/services/transfers.service';
import { QuotationsService } from './quotations/services/quotations.service';
import { StoreOrdersService } from './orders/services/store-orders.service';

/**
 * QUI-1021: the stats cards of a store module must show the numbers of the
 * active store. These caches are module-level (they outlive the page), and the
 * backend resolves the store from the session, so the URL is the same for
 * every store. Before the fix, switching from store A to store B without a
 * reload served A's cached stats for up to 30 s and never asked the backend.
 */
interface StatsCacheCase {
  name: string;
  service: Type<unknown>;
  endpoint: string;
  load: (service: any) => Observable<unknown>;
  invalidate: (service: any) => void;
}

const CASES: StatsCacheCase[] = [
  {
    name: 'Remisiones (DispatchNotesService.getStats)',
    service: DispatchNotesService,
    endpoint: 'store/dispatch-notes/stats',
    load: (s: DispatchNotesService) => s.getStats(),
    invalidate: (s: DispatchNotesService) => s.invalidateCache(),
  },
  {
    name: 'Roles (StoreRolesService.getStats)',
    service: StoreRolesService,
    endpoint: 'store/roles/stats',
    load: (s: StoreRolesService) => s.getStats(),
    invalidate: (s: StoreRolesService) => s.invalidateCache(),
  },
  {
    name: 'Planillas de ruta (PlanillasRutasService.getStats)',
    service: PlanillasRutasService,
    endpoint: 'store/dispatch-routes/stats',
    load: (s: PlanillasRutasService) => s.getStats(),
    invalidate: (s: PlanillasRutasService) => s.invalidateStatsCache(),
  },
  {
    name: 'Traslados (TransfersService.getStats)',
    service: TransfersService,
    endpoint: 'store/stock-transfers/stats',
    load: (s: TransfersService) => s.getStats(),
    invalidate: (s: TransfersService) => s.invalidateCache(),
  },
  {
    name: 'Cotizaciones (QuotationsService.getQuotationStats)',
    service: QuotationsService,
    endpoint: 'store/quotations/stats',
    load: (s: QuotationsService) => s.getQuotationStats(),
    invalidate: (s: QuotationsService) => s.invalidateCache(),
  },
  {
    name: 'Órdenes (StoreOrdersService.getOrderStats)',
    service: StoreOrdersService,
    endpoint: 'store/orders/stats',
    load: (s: StoreOrdersService) => s.getOrderStats(),
    invalidate: (s: StoreOrdersService) => s.invalidateCache(),
  },
];

/** Total carried by a stats response, whether or not the service unwraps `data`. */
function totalOf(value: unknown): number | undefined {
  const body = value as { total?: number; data?: { total?: number } } | null;
  return body?.data?.total ?? body?.total;
}

describe('Store stats caches across a store switch (QUI-1021)', () => {
  for (const testCase of CASES) {
    describe(testCase.name, () => {
      let activeStore: { id: number } | null;
      let service: unknown;
      let http: HttpTestingController;
      const url = `${environment.apiUrl}/${testCase.endpoint}`;

      beforeEach(() => {
        activeStore = { id: 1 };
        TestBed.configureTestingModule({
          providers: [
            provideZonelessChangeDetection(),
            provideHttpClient(),
            provideHttpClientTesting(),
            { provide: AuthFacade, useValue: { userStore: () => activeStore } },
            {
              provide: StoreContextService,
              useValue: { getStoreId: () => activeStore?.id ?? null },
            },
            { provide: AiScanJobService, useValue: {} },
          ],
        });
        service = TestBed.inject(testCase.service);
        http = TestBed.inject(HttpTestingController);
        testCase.invalidate(service);
      });

      afterEach(() => {
        http.verify();
        testCase.invalidate(service);
      });

      /** Loads the stats, answering with `total` when a request goes out. */
      function load(total: number): { requested: boolean; total: number | undefined } {
        let received: unknown;
        testCase.load(service).subscribe((value) => (received = value));
        const requests = http.match(url);
        requests.forEach((request) => request.flush({ data: { total } }));
        return { requested: requests.length === 1, total: totalOf(received) };
      }

      it('serves the cached stats again to the same store inside the TTL', () => {
        expect(load(69)).toEqual({ requested: true, total: 69 });

        expect(load(0)).toEqual({ requested: false, total: 69 });
      });

      it('asks the backend for store B instead of serving the stats of store A', () => {
        expect(load(69)).toEqual({ requested: true, total: 69 });

        activeStore = { id: 2 };

        expect(load(3)).toEqual({ requested: true, total: 3 });
      });

      it('drops the cached stats on an environment switch, even back to the same store', () => {
        expect(load(69)).toEqual({ requested: true, total: 69 });

        resetStoreScopedCaches();

        expect(load(70)).toEqual({ requested: true, total: 70 });
      });
    });
  }
});
