import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { ToastService } from '../../../../../shared/components';
import { MessagingPricesView } from './interfaces/messaging-prices.interface';
import {
  MessagingPricesComponent,
  formatUsd,
  parseDecimal,
} from './messaging-prices.component';
import { MessagingPricesService } from './services/messaging-prices.service';

describe('MessagingPricesComponent', () => {
  let service: jasmine.SpyObj<MessagingPricesService>;
  let toast: jasmine.SpyObj<ToastService>;

  const view: MessagingPricesView = {
    key: 'messaging:prices',
    sms_price_table: { value: { '57': 0.0509 }, source: 'platform_settings' },
    sms_max_price_usd: { value: 0.5, source: 'default' },
    sms_max_price_margin: { value: 1, source: 'default' },
    whatsapp_price_table: { value: {}, source: 'default' },
    email_price_usd: { value: 0.0002, source: 'environment' },
    fallbacks: { sms_per_segment_usd: 0.1, whatsapp_per_message_usd: 0.05 },
    updated_by_user_id: 1,
    updated_at: '2026-01-01T00:00:00.000Z',
  };

  function setUp(opts: { allowed?: boolean } = {}) {
    const allowed = opts.allowed ?? true;
    service = jasmine.createSpyObj<MessagingPricesService>(
      'MessagingPricesService',
      ['getPrices', 'updatePrices'],
    );
    service.getPrices.and.returnValue(of(view));
    service.updatePrices.and.returnValue(of(view));
    toast = jasmine.createSpyObj<ToastService>('ToastService', [
      'success',
      'error',
      'info',
    ]);

    TestBed.configureTestingModule({
      imports: [MessagingPricesComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MessagingPricesService, useValue: service },
        { provide: ToastService, useValue: toast },
        {
          provide: AuthFacade,
          useValue: { hasPermission: () => allowed, hasRole: () => false },
        },
      ],
    });
    const fixture = TestBed.createComponent(MessagingPricesComponent);
    TestBed.inject(ApplicationRef).tick();
    return fixture.componentInstance;
  }

  it('parses decimals with dot or comma and rejects junk', () => {
    expect(parseDecimal('0.0509')).toBe(0.0509);
    expect(parseDecimal('0,0509')).toBe(0.0509);
    expect(Number.isNaN(parseDecimal('abc'))).toBe(true);
    expect(Number.isNaN(parseDecimal(''))).toBe(true);
    expect(formatUsd(0.1)).toBe('0,10');
  });

  it('rejects a number that overflows to Infinity instead of saving it as "use fallback"', () => {
    const huge = '1' + '0'.repeat(400);
    expect(Number.isNaN(parseDecimal(huge))).toBe(true);

    const c = setUp();
    c.updateScalar('sms_max_price_usd', huge);
    expect(c.scalarErrors().sms_max_price_usd).toBeDefined();
    expect(c.canSave()).toBe(false);

    c.addRow('whatsapp_price_table');
    const row = c.rows.whatsapp_price_table().at(-1)!;
    c.updateRow('whatsapp_price_table', row.id, 'country', '57');
    c.updateRow('whatsapp_price_table', row.id, 'price', huge);
    expect(c.tableErrors.whatsapp_price_table().errors[row.id].price).toBeDefined();
  });

  it('loads the view on init and fills the drafts', () => {
    const c = setUp();
    expect(service.getPrices).toHaveBeenCalledTimes(1);
    expect(c.rows.sms_price_table()[0].country).toBe('57');
    expect(c.rows.sms_price_table()[0].price).toBe('0.0509');
    expect(c.scalars().email_price_usd).toBe('0.0002');
    expect(c.canSave()).toBe(false);
  });

  it('does not load without read permission', () => {
    const c = setUp({ allowed: false });
    expect(c.canRead()).toBe(false);
    expect(service.getPrices).not.toHaveBeenCalled();
  });

  it('saves only the changed fields', () => {
    const c = setUp();
    c.addRow('sms_price_table');
    const row = c.rows.sms_price_table()[1];
    c.updateRow('sms_price_table', row.id, 'country', '52');
    c.updateRow('sms_price_table', row.id, 'price', '0,07');
    expect(c.canSave()).toBe(true);
    c.save();
    expect(service.updatePrices).toHaveBeenCalledOnceWith({
      sms_price_table: { '57': 0.0509, '52': 0.07 },
    });
    expect(toast.success).toHaveBeenCalled();
  });

  it('sends null for a field marked "Usar respaldo"', () => {
    const c = setUp();
    c.useFallback('sms_price_table');
    c.save();
    expect(service.updatePrices).toHaveBeenCalledOnceWith({
      sms_price_table: null,
    });
  });

  it('blocks saving on invalid or repeated country codes and bad numbers', () => {
    const c = setUp();
    c.addRow('sms_price_table');
    const row = c.rows.sms_price_table()[1];
    c.updateRow('sms_price_table', row.id, 'country', '57');
    c.updateRow('sms_price_table', row.id, 'price', '0.1');
    expect(c.hasErrors()).toBe(true);
    expect(c.canSave()).toBe(false);

    c.updateRow('sms_price_table', row.id, 'country', 'abc');
    expect(c.tableErrors.sms_price_table().errors[row.id].country).toBeDefined();

    c.updateRow('sms_price_table', row.id, 'country', 'default');
    c.updateRow('sms_price_table', row.id, 'price', '0');
    expect(c.tableErrors.sms_price_table().errors[row.id].price).toBeDefined();
    c.removeRow('sms_price_table', row.id);
    expect(c.hasErrors()).toBe(false);

    c.updateScalar('sms_max_price_margin', '0.5');
    c.updateScalar('sms_max_price_usd', '0');
    c.updateScalar('email_price_usd', '-1');
    expect(Object.keys(c.scalarErrors()).length).toBe(3);
    expect(c.canSave()).toBe(false);
  });

  it('shows the backend 400 message and keeps the draft', () => {
    const c = setUp();
    service.updatePrices.and.returnValue(
      throwError(() => ({ error: { message: 'Precio inválido' } })),
    );
    c.updateScalar('email_price_usd', '0.5');
    c.save();
    expect(toast.error).toHaveBeenCalled();
    expect(c.saving()).toBe(false);
    expect(c.scalars().email_price_usd).toBe('0.5');
  });
});
