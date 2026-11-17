import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ToastService } from '../../../../../../shared/components/index';
import { StoreSubscriptionService } from '../../services/store-subscription.service';
import { SubscriptionFacade } from '../../../../../../core/store/subscription/subscription.facade';
import { BillingHistoryComponent } from './billing-history.component';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * QUI-693 — the billing history header must not say "Activa" (green) for a
 * subscription whose paid cycle already ended, same as Mi Suscripción.
 */
describe('BillingHistoryComponent — header badge (QUI-693)', () => {
  function setup(state: string, periodEndOffsetDays: number): BillingHistoryComponent {
    TestBed.configureTestingModule({
      imports: [BillingHistoryComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: SubscriptionFacade,
          useValue: {
            status: signal(state),
            current: signal({
              state,
              current_period_end: new Date(Date.now() + periodEndOffsetDays * DAY_MS).toISOString(),
            }),
          },
        },
        { provide: StoreSubscriptionService, useValue: {} },
        { provide: ToastService, useValue: jasmine.createSpyObj('ToastService', ['success', 'error', 'info']) },
      ],
    });
    // Only the header bindings are under test: skip the page markup.
    TestBed.overrideComponent(BillingHistoryComponent, { set: { template: '', imports: [] } });
    return TestBed.createComponent(BillingHistoryComponent).componentInstance;
  }

  it('active with the cycle already ended reads "Vencida" in yellow', () => {
    const cmp = setup('active', -3);

    expect(cmp.headerBadgeText()).toBe('Vencida');
    expect(cmp.headerBadgeColor()).toBe('yellow');
  });

  it('active inside its paid cycle keeps "Activa" in green', () => {
    const cmp = setup('active', 10);

    expect(cmp.headerBadgeText()).toBe('Activa');
    expect(cmp.headerBadgeColor()).toBe('green');
  });
});
