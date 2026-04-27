import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { Subject, of } from 'rxjs';

import { PlatformGatewayView } from '../../interfaces/platform-gateway.interface';
import { GatewayAdminService } from '../../services/gateway-admin.service';
import { GatewayComponent } from './gateway.component';

describe('GatewayComponent', () => {
  let fixture: ComponentFixture<GatewayComponent>;
  let component: GatewayComponent;
  let gatewayServiceSpy: jasmine.SpyObj<GatewayAdminService>;

  const unconfiguredView: PlatformGatewayView = {
    configured: false,
    processor: 'wompi',
    environment: null,
    is_active: false,
    last_tested_at: null,
    last_test_result: null,
    credentials_masked: null,
    updated_at: null,
  };

  const configuredView: PlatformGatewayView = {
    configured: true,
    processor: 'wompi',
    environment: 'sandbox',
    is_active: true,
    last_tested_at: new Date('2026-04-25T12:00:00Z').toISOString(),
    last_test_result: { ok: true, merchant_id: 'M123' },
    credentials_masked: {
      public_key: 'pub_••••a1b2',
      private_key: 'prv_••••cd34',
      events_secret: '••••ef56',
      integrity_secret: '••••gh78',
    },
    updated_at: new Date('2026-04-25T12:00:00Z').toISOString(),
  };

  function setUp(initial$: ReturnType<GatewayAdminService['getWompi']>) {
    gatewayServiceSpy = jasmine.createSpyObj<GatewayAdminService>(
      'GatewayAdminService',
      ['getWompi', 'saveWompi', 'testWompi'],
    );
    gatewayServiceSpy.getWompi.and.returnValue(initial$);

    TestBed.configureTestingModule({
      imports: [GatewayComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: GatewayAdminService, useValue: gatewayServiceSpy },
      ],
    });

    fixture = TestBed.createComponent(GatewayComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  it('calls getWompi on init', () => {
    setUp(of(unconfiguredView));
    expect(gatewayServiceSpy.getWompi).toHaveBeenCalledTimes(1);
  });

  it('marks form invalid without secrets when no previous config exists', () => {
    setUp(of(unconfiguredView));
    expect(component.isConfigured()).toBe(false);
    // Required validators should make secrets invalid when empty.
    expect(component.form.controls.public_key.valid).toBe(false);
    expect(component.form.controls.private_key.valid).toBe(false);
    expect(component.form.controls.events_secret.valid).toBe(false);
    expect(component.form.controls.integrity_secret.valid).toBe(false);
    expect(component.form.invalid).toBe(true);
  });

  it('marks form valid without re-entering secrets when already configured', () => {
    setUp(of(configuredView));
    expect(component.isConfigured()).toBe(true);
    // After applyConfigToForm clears the required validator, empty secrets
    // are acceptable (they mean "do not change").
    expect(component.form.controls.public_key.valid).toBe(true);
    expect(component.form.controls.private_key.valid).toBe(true);
    expect(component.form.valid).toBe(true);
  });

  it('blocks submit when environment=production without confirm_production', () => {
    setUp(of(configuredView));

    component.form.controls.environment.setValue('production');
    component.form.controls.confirm_production.setValue(false);
    component.form.updateValueAndValidity();

    expect(component.form.invalid).toBe(true);
    expect(
      component.form.errors?.['confirm_production_required'],
    ).toBeTrue();

    component.onSave();
    expect(gatewayServiceSpy.saveWompi).not.toHaveBeenCalled();
  });

  it('allows submit when environment=production and confirm_production=true', () => {
    setUp(of(configuredView));
    gatewayServiceSpy.saveWompi.and.returnValue(of(configuredView));

    component.form.controls.environment.setValue('production');
    component.form.controls.confirm_production.setValue(true);
    component.form.controls.public_key.setValue('pub_prod_abcdef');
    component.form.controls.private_key.setValue('prv_prod_abcdef');
    component.form.controls.events_secret.setValue('events-secret');
    component.form.controls.integrity_secret.setValue('integrity-secret');
    component.form.updateValueAndValidity();

    expect(component.form.valid).toBe(true);

    component.onSave();
    expect(gatewayServiceSpy.saveWompi).toHaveBeenCalledTimes(1);
  });

  it('keeps loading true while initial config has not resolved', () => {
    const pending$ = new Subject<PlatformGatewayView>();
    setUp(pending$.asObservable());
    expect(component.loading()).toBe(true);
    pending$.next(unconfiguredView);
    pending$.complete();
    expect(component.loading()).toBe(false);
  });
});
