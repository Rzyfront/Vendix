import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of } from 'rxjs';

import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { DialogService } from '../../../../../../shared/components/dialog/dialog.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import {
  CreateReminderPayload,
  Reminder,
  RemindersList,
  RemindersService,
  UpdateReminderPayload,
} from '../../services/reminders.service';
import { RemindersLogComponent } from './reminders-log.component';
import { reminderProgress, sortReminders } from './reminders-log.util';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 15, 15, 0, 0);

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function reminder(id: number, patch: Partial<Reminder> = {}): Reminder {
  return {
    id,
    title: `Recordatorio ${id}`,
    note: null,
    remind_at: null,
    status: 'pending',
    bucket: 'no_date',
    link: null,
    source: 'manual',
    completed_at: null,
    created_at: iso(NOW - 10 * DAY),
    updated_at: iso(NOW - 10 * DAY),
    ...patch,
  };
}

describe('reminders-log util', () => {
  it('orders pending reminders from the soonest to the latest, overdue first, no date last, done at the end', () => {
    const items = [
      reminder(1, { title: 'Sin fecha' }),
      reminder(2, { title: 'En 5 días', remind_at: iso(NOW + 5 * DAY), bucket: 'upcoming' }),
      reminder(3, { title: 'Hecho', status: 'done', bucket: 'done', completed_at: iso(NOW - HOUR) }),
      reminder(4, { title: 'Vencido', remind_at: iso(NOW - 2 * DAY), bucket: 'overdue' }),
      reminder(5, { title: 'En 2 horas', remind_at: iso(NOW + 2 * HOUR), bucket: 'today' }),
    ];

    expect(sortReminders(items).map((r) => r.title)).toEqual([
      'Vencido',
      'En 2 horas',
      'En 5 días',
      'Sin fecha',
      'Hecho',
    ]);
  });

  it('fills the bar with the share of time elapsed since creation', () => {
    const half = reminder(1, {
      created_at: iso(NOW - 4 * DAY),
      remind_at: iso(NOW + 4 * DAY),
    });
    expect(reminderProgress(half, NOW)).toEqual({ percent: 50, tone: 'far', label: 'Faltan 4 días' });

    const close = reminder(2, {
      created_at: iso(NOW - 9 * DAY),
      remind_at: iso(NOW + 2 * DAY),
    });
    expect(reminderProgress(close, NOW)).toEqual({ percent: 82, tone: 'near', label: 'Faltan 2 días' });

    const lastHours = reminder(3, {
      created_at: iso(NOW - HOUR),
      remind_at: iso(NOW + 3 * HOUR),
    });
    expect(reminderProgress(lastHours, NOW)).toEqual({ percent: 25, tone: 'near', label: 'Faltan 3 h' });
  });

  it('shows a full red bar when overdue and no bar without date or once done', () => {
    const overdue = reminder(1, { remind_at: iso(NOW - 2 * DAY) });
    expect(reminderProgress(overdue, NOW)).toEqual({
      percent: 100,
      tone: 'overdue',
      label: 'Venció hace 2 días',
    });

    expect(reminderProgress(reminder(2), NOW)).toBeNull();
    expect(
      reminderProgress(reminder(3, { status: 'done', remind_at: iso(NOW + DAY) }), NOW),
    ).toBeNull();
  });
});

class FakeRemindersService {
  items: Reminder[] = [];
  creates: CreateReminderPayload[] = [];
  updates: { id: number; payload: UpdateReminderPayload }[] = [];

  list(status: 'pending' | 'done' | 'all'): Observable<RemindersList> {
    const items = status === 'all' ? this.items : this.items.filter((r) => r.status === status);
    return of({ items, timezone: 'America/Bogota' });
  }

  create(payload: CreateReminderPayload): Observable<Reminder> {
    this.creates.push(payload);
    const created = reminder(100 + this.creates.length, {
      title: payload.title,
      note: payload.note ?? null,
    });
    this.items = [...this.items, created];
    return of(created);
  }

  update(id: number, payload: UpdateReminderPayload): Observable<Reminder> {
    this.updates.push({ id, payload });
    this.items = this.items.map((r) =>
      r.id === id ? { ...r, status: payload.status ?? r.status } : r,
    );
    return of(this.items.find((r) => r.id === id)!);
  }
}

describe('RemindersLogComponent (dashboard Bitácora)', () => {
  let fixture: ComponentFixture<RemindersLogComponent>;
  let api: FakeRemindersService;

  function root(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function rowTitles(): string[] {
    return Array.from(root().querySelectorAll('[data-testid="reminder-title"]')).map(
      (el) => el.textContent?.trim() ?? '',
    );
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function buttonByText(text: string): HTMLButtonElement {
    const button = Array.from(root().querySelectorAll<HTMLButtonElement>('button')).find(
      (el) => el.textContent?.trim() === text,
    );
    if (!button) throw new Error(`Button "${text}" is not rendered`);
    return button;
  }

  /** The reminder form fields as the user sees them (real DOM elements). */
  function formFields(): {
    title: HTMLInputElement;
    note: HTMLTextAreaElement;
    remindAt: HTMLInputElement;
  } {
    const form = root().querySelector('form');
    if (!form) throw new Error('Reminder form is not rendered');
    return {
      title: form.querySelector<HTMLInputElement>('input[placeholder^="Ej: Llamar"]')!,
      note: form.querySelector<HTMLTextAreaElement>('textarea')!,
      remindAt: form.querySelector<HTMLInputElement>('input[type="datetime-local"]')!,
    };
  }

  function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    el.value = value;
    el.dispatchEvent(new Event('input'));
  }

  /** America/Bogota is UTC-5 all year (no DST): its wall clock is a fixed shift. */
  function bogotaWallClock(isoInstant: string): string {
    return new Date(Date.parse(isoInstant) - 5 * HOUR).toISOString().slice(0, 16);
  }

  beforeEach(async () => {
    api = new FakeRemindersService();
    const now = Date.now();
    api.items = [
      reminder(1, {
        title: 'Sin fecha',
        note: 'Nota oculta en la fila',
        link: { type: 'product', id: 9, label: 'Leche entera', url: '/admin/products/9' },
      }),
      reminder(2, {
        title: 'Lejano',
        remind_at: new Date(now + 6 * DAY + HOUR).toISOString(),
        created_at: new Date(now - 2 * DAY).toISOString(),
        bucket: 'upcoming',
      }),
      reminder(3, {
        title: 'Vencido',
        note: 'Pagar al proveedor',
        source: 'vex',
        remind_at: new Date(now - DAY - HOUR).toISOString(),
        bucket: 'overdue',
      }),
    ];

    TestBed.configureTestingModule({
      imports: [RemindersLogComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: RemindersService, useValue: api },
        { provide: ToastService, useValue: { success: () => undefined, error: () => undefined } },
        { provide: DialogService, useValue: { confirm: () => Promise.resolve(false) } },
        // The edit form's app-input pulls CurrencyFormatService (NgRx store) in.
        {
          provide: CurrencyFormatService,
          useValue: {
            currencySymbol: signal('$'),
            currencyFormatStyle: () => 'comma_dot',
            currencyDecimals: () => 0,
            loadCurrency: () => undefined,
            format: (v: number) => `$${v}`,
          },
        },
      ],
    });
    fixture = TestBed.createComponent(RemindersLogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('lists only title and date, ordered from the soonest due date', () => {
    expect(rowTitles()).toEqual(['Vencido', 'Lejano', 'Sin fecha']);
    const list = root().querySelector('[data-testid="reminders-list"]')!;
    expect(list.textContent).not.toContain('Nota oculta en la fila');
    expect(list.textContent).not.toContain('Leche entera');
    expect(list.querySelectorAll('[data-testid="reminder-detail-button"]').length).toBe(3);
  });

  it('renders an accessible progress bar only for dated reminders', () => {
    const bars = Array.from(
      root().querySelectorAll<HTMLElement>('[data-testid="reminder-progress"]'),
    );
    expect(bars.length).toBe(2);
    expect(bars[0].getAttribute('role')).toBe('progressbar');
    expect(bars[0].getAttribute('aria-valuenow')).toBe('100');
    expect(bars[0].getAttribute('aria-valuetext')).toBe('Venció hace 1 día');
    expect(bars[1].getAttribute('aria-valuenow')).toBe('25');
    expect(bars[1].getAttribute('aria-valuetext')).toBe('Faltan 6 días');
  });

  it('opens the detail in a modal with note, link, status and source', async () => {
    const component = fixture.componentInstance;
    expect(component.busy()).toBe(false);

    const buttons = root().querySelectorAll<HTMLButtonElement>(
      '[data-testid="reminder-detail-button"]',
    );
    buttons[2].click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.detailOpen()).toBe(true);
    expect(component.busy()).toBe(true);
    const detail = document.querySelector('[data-testid="reminder-detail"]')!;
    expect(detail).toBeTruthy();
    expect(detail.textContent).toContain('Nota oculta en la fila');
    expect(detail.textContent).toContain('Pendiente');
    expect(detail.textContent).toContain('Creado manualmente');
    const link = detail.querySelector('[data-testid="reminder-detail-link"]')!;
    expect(link.textContent?.trim()).toBe('Leche entera');
    expect(link.getAttribute('href')).toBe('/admin/products/9');
  });

  it('marks the reminder as done from the detail and closes it once hidden', () => {
    const component = fixture.componentInstance;
    const vencido = api.items.find((r) => r.id === 3)!;
    component.openDetail(vencido);
    fixture.detectChanges();
    expect(component.detail()?.source).toBe('vex');

    component.toggleStatus(vencido);
    fixture.detectChanges();

    expect(api.updates).toEqual([{ id: 3, payload: { status: 'done' } }]);
    // The pending list no longer has it ("Ver hechos" is off), so the detail closes.
    expect(component.detailOpen()).toBe(false);
  });

  it('creates the reminder with what the user typed in the form', async () => {
    buttonByText('Nuevo').click();
    await settle();

    const fields = formFields();
    typeInto(fields.title, 'Llamar al proveedor de lácteos');
    typeInto(fields.note, 'Pedir leche y queso');
    typeInto(fields.remindAt, '2026-11-18T09:00');
    await settle();

    buttonByText('Guardar').click();
    await settle();

    expect(api.creates).toEqual([
      {
        title: 'Llamar al proveedor de lácteos',
        note: 'Pedir leche y queso',
        remind_at: '2026-11-18T09:00',
      },
    ]);
    expect(root().textContent).not.toContain('El título es obligatorio');
    expect(fixture.componentInstance.modalOpen()).toBe(false);
    expect(rowTitles()).toContain('Llamar al proveedor de lácteos');
  });

  it('still blocks saving without a title and shows the error', async () => {
    buttonByText('Nuevo').click();
    await settle();

    buttonByText('Guardar').click();
    await settle();

    expect(api.creates).toEqual([]);
    expect(fixture.componentInstance.modalOpen()).toBe(true);
    expect(root().querySelector('form')!.textContent).toContain('El título es obligatorio');
  });

  it('prefills the edit form and sends the edited values in the PATCH', async () => {
    const vencido = api.items.find((r) => r.id === 3)!;
    root().querySelectorAll<HTMLButtonElement>('[data-testid="reminder-detail-button"]')[0].click();
    await settle();
    buttonByText('Editar').click();
    await settle();

    const fields = formFields();
    expect(fields.title.value).toBe('Vencido');
    expect(fields.note.value).toBe('Pagar al proveedor');
    expect(fields.remindAt.value).toBe(bogotaWallClock(vencido.remind_at!));

    typeInto(fields.title, 'Pagar al proveedor de lácteos');
    typeInto(fields.remindAt, '2026-11-21T09:30');
    await settle();

    buttonByText('Guardar').click();
    await settle();

    expect(api.updates).toEqual([
      {
        id: 3,
        payload: {
          title: 'Pagar al proveedor de lácteos',
          note: 'Pagar al proveedor',
          remind_at: '2026-11-21T09:30',
        },
      },
    ]);
    expect(api.creates).toEqual([]);
  });
});
