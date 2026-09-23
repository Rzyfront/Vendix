import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { RecipesService } from '../../recipes/services/recipes.service';
import { KdsTicketCardComponent } from './kds-ticket-card/kds-ticket-card.component';
import { KdsTicketDetailModalComponent } from './kds-ticket-detail-modal/kds-ticket-detail-modal.component';
import { KitchenTicketsService } from '../services/kitchen-tickets.service';
import type { KitchenTicket } from '../interfaces';

const ticket = (takeawayFlags: boolean[]): KitchenTicket => ({
  id: 1,
  store_id: 10,
  order_id: 2,
  status: 'ready',
  fired_at: '2026-09-23T13:00:00Z',
  items: takeawayFlags.map((is_takeaway, index) => ({
    id: index + 1,
    kitchen_ticket_id: 1,
    order_item_id: index + 10,
    product_id: 333,
    quantity: 1,
    status: 'ready',
    order_item: { is_takeaway },
  })),
});

describe('KDS delivery disabled reason', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [KdsTicketCardComponent, KdsTicketDetailModalComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: AuthFacade, useValue: {} },
        { provide: RecipesService, useValue: { recipeChanged$: new Subject() } },
        { provide: KitchenTicketsService, useValue: {} },
        { provide: ToastService, useValue: {} },
      ],
    })
      .overrideComponent(KdsTicketCardComponent, { set: { template: '', imports: [] } })
      .overrideComponent(KdsTicketDetailModalComponent, { set: { template: '', imports: [] } })
      .compileComponents();
  });

  for (const [flags, allowed] of [
    [[true], true],
    [[true, false], false],
  ] as const) {
    it(`keeps card and modal hints aligned for ${flags.join('/')}`, () => {
      const card = TestBed.createComponent(KdsTicketCardComponent);
      card.componentRef.setInput('ticket', ticket([...flags]));
      card.detectChanges();

      const modal = TestBed.createComponent(KdsTicketDetailModalComponent);
      modal.componentRef.setInput('ticket', ticket([...flags]));
      modal.detectChanges();

      expect(card.componentInstance.allTakeaway()).toBe(allowed);
      expect(modal.componentInstance.allTakeaway()).toBe(allowed);
      for (const reason of [
        card.componentInstance.deliverDisabledReason(),
        modal.componentInstance.deliverDisabledReason(),
      ]) {
        if (allowed) {
          expect(reason).toBeNull();
        } else {
          expect(reason).toContain('entrégalos por ítem desde la mesa');
        }
      }
    });
  }
});
