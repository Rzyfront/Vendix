import { WritableSignal, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';

import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import {
  Reminder,
  ReminderListFilter,
  RemindersList,
  RemindersService,
  UpdateReminderPayload,
} from '../../../dashboard/services/reminders.service';
import { VexConversation } from '../../models/vex.models';
import { VexChatStore } from '../../state/vex-chat.store';
import { VexLogStore } from '../../state/vex-log.store';
import { VexLogSidebarComponent } from './vex-log-sidebar.component';

function reminder(partial: Partial<Reminder> & Pick<Reminder, 'id' | 'title'>): Reminder {
  return {
    note: null,
    remind_at: null,
    status: 'pending',
    bucket: 'no_date',
    link: null,
    source: 'manual',
    completed_at: null,
    created_at: '2026-11-01T12:00:00Z',
    updated_at: '2026-11-01T12:00:00Z',
    ...partial,
  };
}

/**
 * In-memory `/store/reminders` of the signed-in user: the only data the sidebar
 * may show. Mirrors the API paging: filter by status, order by status then
 * `remind_at`, and keep `limit` rows (default 100).
 */
class FakeRemindersService {
  rows: Reminder[] = [];
  listCalls = 0;
  requests: Array<{ status: ReminderListFilter; limit: number | undefined }> = [];
  updates: Array<{ id: number; payload: UpdateReminderPayload }> = [];
  failNextList = false;

  list(status: ReminderListFilter, limit?: number): Observable<RemindersList> {
    this.listCalls++;
    this.requests.push({ status, limit });
    if (this.failNextList) {
      this.failNextList = false;
      return throwError(() => new Error('boom'));
    }
    const page = this.rows
      .filter((r) => status === 'all' || r.status === status)
      .sort(
        (a, b) =>
          (a.status === b.status ? 0 : a.status === 'pending' ? -1 : 1) ||
          (a.remind_at ?? '\uffff').localeCompare(b.remind_at ?? '\uffff'),
      )
      .slice(0, limit ?? 100);
    return of({ items: page.map((r) => ({ ...r })), timezone: 'America/Bogota' });
  }

  update(id: number, payload: UpdateReminderPayload): Observable<Reminder> {
    this.updates.push({ id, payload });
    const row = this.rows.find((r) => r.id === id)!;
    if (payload.status === 'done') {
      Object.assign(row, { status: 'done', bucket: 'done', completed_at: '2026-11-15T12:00:00Z' });
    } else if (payload.status === 'pending') {
      Object.assign(row, { status: 'pending', bucket: 'no_date', completed_at: null });
    }
    return of({ ...row });
  }
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('VexLogSidebarComponent (Bitácora empresarial)', () => {
  let fixture: ComponentFixture<VexLogSidebarComponent>;
  let api: FakeRemindersService;
  let conversations: WritableSignal<VexConversation[]>;
  let busyPlan: WritableSignal<string | null>;

  async function render(): Promise<HTMLElement> {
    fixture = TestBed.createComponent(VexLogSidebarComponent);
    await flush();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  async function settle(): Promise<HTMLElement> {
    await flush();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  function chip(root: HTMLElement, label: string): HTMLButtonElement {
    const found = Array.from(root.querySelectorAll<HTMLButtonElement>('[aria-label="Filtrar recordatorios"] button')).find(
      (b) => b.textContent!.trim().startsWith(label),
    );
    if (!found) throw new Error(`chip ${label} not found`);
    return found;
  }

  function text(root: HTMLElement): string {
    return root.textContent!.replace(/\s+/g, ' ');
  }

  beforeEach(() => {
    api = new FakeRemindersService();
    api.rows = [
      reminder({ id: 1, title: 'Llamar al proveedor', bucket: 'overdue', remind_at: '2026-11-10T15:00:00Z' }),
      reminder({ id: 2, title: 'Revisar caja', bucket: 'today', remind_at: '2026-11-15T20:00:00Z', source: 'vex' }),
      reminder({ id: 3, title: 'Pedir inventario', bucket: 'upcoming', remind_at: '2026-11-20T15:00:00Z' }),
      reminder({
        id: 4,
        title: 'Pagar arriendo',
        status: 'done',
        bucket: 'done',
        completed_at: '2026-11-14T10:00:00Z',
      }),
    ];
    conversations = signal<VexConversation[]>([]);
    busyPlan = signal<string | null>(null);

    TestBed.configureTestingModule({
      imports: [VexLogSidebarComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        VexLogStore,
        { provide: RemindersService, useValue: api },
        {
          provide: VexChatStore,
          useValue: { conversations, busy_plan_id: busyPlan },
        },
        { provide: StoreSettingsFacade, useValue: { timezone: signal('America/Bogota') } },
        { provide: ToastService, useValue: { error: () => undefined, success: () => undefined } },
      ],
    });
  });

  it('shows only the user reminders, pending first, with the attention badge', async () => {
    const root = await render();
    expect(text(root)).toContain('Bitácora empresarial');
    expect(text(root)).toContain('Llamar al proveedor');
    expect(text(root)).toContain('Revisar caja');
    expect(text(root)).toContain('Pedir inventario');
    expect(text(root)).not.toContain('Pagar arriendo');
    // Overdue + today = 2.
    expect(root.querySelector('[aria-label="2 para hoy o vencidos"]')).not.toBeNull();
    // Old event-feed filters are gone.
    expect(text(root)).not.toContain('Ventas');
    expect(text(root)).not.toContain('Marcar como vistos');
  });

  it('offers the Bitácora filters with their counts', async () => {
    const root = await render();
    expect(chip(root, 'Pendientes').textContent).toContain('3');
    expect(chip(root, 'Hoy').textContent).toContain('1');
    expect(chip(root, 'Vencidos').textContent).toContain('1');
    expect(chip(root, 'Próximos').textContent).toContain('1');
    expect(chip(root, 'Hechos').textContent).toContain('1');
  });

  it('filters by bucket and shows done reminders under "Hechos"', async () => {
    let root = await render();
    chip(root, 'Hoy').click();
    root = await settle();
    expect(text(root)).toContain('Revisar caja');
    expect(text(root)).not.toContain('Llamar al proveedor');

    chip(root, 'Hechos').click();
    root = await settle();
    expect(text(root)).toContain('Pagar arriendo');
    expect(text(root)).not.toContain('Revisar caja');
  });

  it('completes a reminder from the sidebar and re-reads the list', async () => {
    let root = await render();
    const before = api.listCalls;
    const check = root.querySelector<HTMLButtonElement>('[aria-label="Marcar como hecho"]')!;
    check.click();
    await wait(10);
    root = await settle();
    expect(api.updates).toEqual([{ id: 1, payload: { status: 'done' } }]);
    // One refresh = one pending page + one done page.
    expect(api.listCalls).toBe(before + 2);
    expect(text(root)).not.toContain('Llamar al proveedor');
    expect(chip(root, 'Hechos').textContent).toContain('2');
  });

  it('refreshes after a Vex turn finishes, so a reminder Vex created appears', async () => {
    let root = await render();
    // Vex starts answering: nothing to re-read yet.
    conversations.set([
      {
        id: 'c1',
        title: 'Chat',
        created_at: new Date(),
        updated_at: new Date(),
        messages: [{ id: 'a1', role: 'agent', content: '', created_at: new Date(), streaming: true }],
      },
    ]);
    await settle();
    api.rows.push(reminder({ id: 5, title: 'Llamar a Ana', bucket: 'today', source: 'vex' }));
    // Vex finishes the turn where it created the reminder.
    conversations.set([
      {
        id: 'c1',
        title: 'Chat',
        created_at: new Date(),
        updated_at: new Date(),
        messages: [{ id: 'a1', role: 'agent', content: 'Listo', created_at: new Date(), streaming: false }],
      },
    ]);
    await settle();
    await wait(500);
    root = await settle();
    expect(text(root)).toContain('Llamar a Ana');
  });

  it('refreshes after a confirmed step is applied (Vex deleting a reminder)', async () => {
    let root = await render();
    busyPlan.set('plan-1');
    await settle();
    api.rows = api.rows.filter((r) => r.id !== 3);
    busyPlan.set(null);
    await settle();
    await wait(500);
    root = await settle();
    expect(text(root)).not.toContain('Pedir inventario');
  });

  it('shows an inline retry when the reminders cannot be loaded', async () => {
    api.failNextList = true;
    let root = await render();
    expect(text(root)).toContain('No se pudieron cargar los recordatorios');
    const retry = Array.from(root.querySelectorAll('button')).find((b) => b.textContent!.includes('Reintentar'))!;
    retry.click();
    await wait(10);
    root = await settle();
    expect(text(root)).toContain('Llamar al proveedor');
  });

  it('reads pending and done separately, so more than 100 reminders do not cut "Hechos"', async () => {
    api.rows = [
      ...Array.from({ length: 120 }, (_, i) =>
        reminder({ id: 1000 + i, title: `Pendiente ${i}`, bucket: 'upcoming', remind_at: '2026-12-01T15:00:00Z' }),
      ),
      ...Array.from({ length: 130 }, (_, i) =>
        reminder({
          id: 2000 + i,
          title: `Hecho ${i}`,
          status: 'done',
          bucket: 'done',
          completed_at: `2026-11-${String(1 + (i % 14)).padStart(2, '0')}T10:00:00Z`,
        }),
      ),
    ];
    const root = await render();

    expect(api.requests).toEqual([
      { status: 'pending', limit: 200 },
      { status: 'done', limit: 200 },
    ]);
    expect(chip(root, 'Pendientes').textContent).toContain('120');
    expect(chip(root, 'Hechos').textContent).toContain('130');
  });

  it('opens an available linked record (query included) and marks an unavailable one', async () => {
    api.rows[0].link = {
      type: 'invoice',
      type_label: 'Factura',
      id: 91,
      label: 'FV-91',
      available: true,
      url: '/admin/invoicing/invoices?invoiceId=91',
    };
    api.rows[1].link = {
      type: 'product',
      type_label: 'Producto',
      id: 9,
      label: 'Leche entera',
      available: false,
      url: null,
    };
    const root = await render();

    const invoice = Array.from(root.querySelectorAll('a')).find((a) => a.textContent!.includes('FV-91'));
    expect(invoice?.getAttribute('href')).toBe('/admin/invoicing/invoices?invoiceId=91');
    expect(text(invoice!)).toContain('Factura · FV-91');
    expect(Array.from(root.querySelectorAll('a')).some((a) => a.textContent!.includes('Leche entera'))).toBe(false);
    // Separate flex items (spaced by the gap), so no text space between them.
    expect(text(root)).toMatch(/Producto · Leche entera\s*\(no disponible\)/);
  });

  it('links to the dashboard Bitácora to manage reminders', async () => {
    const root = await render();
    const link = Array.from(root.querySelectorAll('a')).find((a) => a.textContent!.includes('Gestionar en el panel'))!;
    expect(link.getAttribute('href')).toBe('/admin/dashboard?tab=bitacora');
  });
});
