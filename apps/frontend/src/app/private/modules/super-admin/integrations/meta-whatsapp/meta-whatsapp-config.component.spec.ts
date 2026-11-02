import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { TenantFacade } from '../../../../../core/store/tenant/tenant.facade';
import { ToastService } from '../../../../../shared/components';
import { MetaWhatsappConfigView } from './interfaces/meta-whatsapp-config.interface';
import {
  ENCRYPTION_KEY_MISSING_MESSAGE,
  MetaWhatsappConfigComponent,
} from './meta-whatsapp-config.component';
import { MetaWhatsappConfigService } from './services/meta-whatsapp-config.service';

describe('MetaWhatsappConfigComponent', () => {
  let service: jasmine.SpyObj<MetaWhatsappConfigService>;
  let toast: jasmine.SpyObj<ToastService>;

  const view: MetaWhatsappConfigView = {
    configured: true,
    key: 'social_sales:meta_whatsapp',
    app_id: '111',
    app_secret_masked: '****1234',
    whatsapp_config_id: '222',
    verify_token_masked: '****5678',
    graph_version: 'v23.0',
    app_review_status: 'pending',
    allow_dev_signup: false,
    updated_by_user_id: 1,
    updated_at: '2026-01-01T00:00:00.000Z',
  };

  function setUp(opts: { allowed?: boolean } = {}) {
    const allowed = opts.allowed ?? true;
    service = jasmine.createSpyObj<MetaWhatsappConfigService>(
      'MetaWhatsappConfigService',
      ['getConfig', 'updateConfig', 'webhookUrl'],
    );
    service.getConfig.and.returnValue(of(view));
    service.updateConfig.and.returnValue(of(view));
    service.webhookUrl.and.returnValue(
      'https://x.test/api/public/meta/whatsapp/webhook',
    );
    toast = jasmine.createSpyObj<ToastService>('ToastService', [
      'success',
      'error',
      'info',
    ]);

    TestBed.configureTestingModule({
      imports: [MetaWhatsappConfigComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MetaWhatsappConfigService, useValue: service },
        { provide: ToastService, useValue: toast },
        {
          provide: AuthFacade,
          useValue: { hasPermission: () => allowed, hasRole: () => false },
        },
        {
          provide: TenantFacade,
          useValue: {
            getCurrentDomainConfig: () => null,
            getCurrentStoreId: () => null,
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(MetaWhatsappConfigComponent);
    TestBed.inject(ApplicationRef).tick();
    return fixture.componentInstance;
  }

  it('loads the masked config on init and fills the form without secrets', () => {
    const c = setUp();
    expect(service.getConfig).toHaveBeenCalledTimes(1);
    expect(c.form.controls.app_id.value).toBe('111');
    expect(c.form.controls.app_secret.value).toBe('');
    expect(c.form.controls.verify_token.value).toBe('');
    expect(c.config()?.app_secret_masked).toBe('****1234');
  });

  it('does not load without read permission', () => {
    const c = setUp({ allowed: false });
    expect(c.canRead()).toBe(false);
    expect(service.getConfig).not.toHaveBeenCalled();
  });

  it('saves only the changed fields', () => {
    const c = setUp();
    c.form.controls.app_id.setValue('999');
    c.save();
    expect(service.updateConfig).toHaveBeenCalledOnceWith({ app_id: '999' });
  });

  it('never sends empty secrets', () => {
    const c = setUp();
    c.form.controls.graph_version.setValue('v24.0');
    c.form.controls.app_secret.setValue('');
    c.form.controls.verify_token.setValue('   ');
    c.save();
    const body = service.updateConfig.calls.mostRecent().args[0];
    expect(body).toEqual({ graph_version: 'v24.0' });
    expect('app_secret' in body).toBe(false);
    expect('verify_token' in body).toBe(false);
  });

  it('does not call PATCH when nothing changed', () => {
    const c = setUp();
    c.save();
    expect(service.updateConfig).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalled();
  });

  it('generates a 64-char hex verify token and exposes it once', () => {
    const c = setUp();
    c.generateVerifyToken();
    const token = c.generatedToken() as string;
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(c.form.controls.verify_token.value).toBe(token);
    c.save();
    expect(service.updateConfig).toHaveBeenCalledOnceWith({
      verify_token: token,
    });
    expect(c.generatedToken()).toBeNull();
  });

  it('shows the encryption-key message on the matching 400', () => {
    const c = setUp();
    service.updateConfig.and.returnValue(
      throwError(() => ({
        error: {
          message:
            'SOCIAL_CHANNEL_ENCRYPTION_KEY es obligatoria para guardar secretos Meta',
        },
      })),
    );
    c.form.controls.app_secret.setValue('test-secret-1234');
    c.save();
    expect(toast.error).toHaveBeenCalledWith(ENCRYPTION_KEY_MISSING_MESSAGE);
    expect(c.saving()).toBe(false);
  });
});
