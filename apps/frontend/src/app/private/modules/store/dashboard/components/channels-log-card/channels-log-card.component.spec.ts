import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { Observable, of } from 'rxjs';

import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { RemindersList, RemindersService } from '../../services/reminders.service';
import { ROTATOR_TIMERS, RotatorTimers } from '../../utils/auto-rotator.util';
import { RemindersLogComponent } from '../reminders-log/reminders-log.component';
import {
  CHANNELS_CARD_ROTATION_MS,
  ChannelsLogCardComponent,
} from './channels-log-card.component';

/** Fake interval clock: time only moves when the test calls tick(). */
class FakeTimers implements RotatorTimers {
  private nextId = 1;
  private readonly intervals = new Map<number, { handler: () => void; ms: number; elapsed: number }>();

  setInterval(handler: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.intervals.set(id, { handler, ms, elapsed: 0 });
    return id;
  }

  clearInterval(id: unknown): void {
    this.intervals.delete(id as number);
  }

  pending(): number {
    return this.intervals.size;
  }

  tick(ms: number): void {
    for (const t of Array.from(this.intervals.values())) {
      t.elapsed += ms;
      while (t.elapsed >= t.ms) {
        t.elapsed -= t.ms;
        t.handler();
      }
    }
  }
}

/** `/store/reminders` of the signed-in user; counts how often the card asks for it. */
class FakeRemindersService {
  listCalls = 0;

  list(): Observable<RemindersList> {
    this.listCalls++;
    return of({ items: [], timezone: 'America/Bogota' });
  }
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('ChannelsLogCardComponent (Rosa · Bitácora)', () => {
  let fixture: ComponentFixture<ChannelsLogCardComponent>;
  let timers: FakeTimers;
  let api: FakeRemindersService;

  function card(): HTMLElement {
    return fixture.nativeElement.querySelector('[data-testid="channels-card"]');
  }

  function visiblePanel(): 'channels' | 'log' {
    const root = fixture.nativeElement as HTMLElement;
    const log = root.querySelector('[data-testid="channels-card-log"]')!;
    const channels = root.querySelector('[data-testid="channels-card-channels"]')!;
    expect(log.classList.contains('hidden')).not.toBe(channels.classList.contains('hidden'));
    return log.classList.contains('hidden') ? 'channels' : 'log';
  }

  function rotate(times = 1): void {
    timers.tick(CHANNELS_CARD_ROTATION_MS * times);
    fixture.detectChanges();
  }

  function remindersLog(): RemindersLogComponent {
    return fixture.debugElement.query(By.directive(RemindersLogComponent)).componentInstance;
  }

  beforeEach(async () => {
    timers = new FakeTimers();
    api = new FakeRemindersService();
    TestBed.configureTestingModule({
      imports: [ChannelsLogCardComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ROTATOR_TIMERS, useValue: timers },
        { provide: RemindersService, useValue: api },
        // The log form's app-input pulls CurrencyFormatService (NgRx store) in.
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
    fixture = TestBed.createComponent(ChannelsLogCardComponent);
    fixture.componentRef.setInput('empty', true);
    fixture.detectChanges();
    await flush();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('starts on Rosa and alternates every 5 s', () => {
    expect(visiblePanel()).toBe('channels');
    rotate();
    expect(visiblePanel()).toBe('log');
    rotate();
    expect(visiblePanel()).toBe('channels');
  });

  it('keeps the Bitácora mounted while rotating: one request, same instance, same "show done" choice', () => {
    const first = remindersLog();
    first.showDone.set(true);
    const callsAfterInit = api.listCalls;

    rotate(6);

    expect(remindersLog()).toBe(first);
    expect(first.showDone()).toBe(true);
    expect(api.listCalls).toBe(callsAfterInit);
    expect(callsAfterInit).toBe(1);
  });

  it('pauses while the pointer is over the card and resumes after leaving', () => {
    card().dispatchEvent(new MouseEvent('mouseenter'));
    rotate(3);
    expect(visiblePanel()).toBe('channels');

    card().dispatchEvent(new MouseEvent('mouseleave'));
    rotate();
    expect(visiblePanel()).toBe('log');
  });

  it('pauses while focus is inside the card and resumes when it leaves', () => {
    card().dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    rotate(3);
    expect(visiblePanel()).toBe('channels');

    card().dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    rotate();
    expect(visiblePanel()).toBe('log');
  });

  it('does not rotate away from the Bitácora while its form is open', () => {
    rotate();
    expect(visiblePanel()).toBe('log');

    remindersLog().modalOpen.set(true);
    fixture.detectChanges();
    rotate(4);
    expect(visiblePanel()).toBe('log');

    remindersLog().modalOpen.set(false);
    fixture.detectChanges();
    rotate();
    expect(visiblePanel()).toBe('channels');
  });

  it('clears its timer when destroyed', () => {
    expect(timers.pending()).toBe(1);
    fixture.destroy();
    expect(timers.pending()).toBe(0);
  });
});
