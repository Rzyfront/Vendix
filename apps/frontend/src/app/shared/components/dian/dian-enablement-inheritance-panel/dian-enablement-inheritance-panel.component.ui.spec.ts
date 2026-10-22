import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import {
  ALL_DIAN_CAPABILITIES,
  DIAN_API_CONTEXT,
  DianConfigApiService,
  type DianEnablementInheritance,
} from '../../../services/dian';
import { ToastService } from '../../toast/toast.service';
import { DianEnablementInheritancePanelComponent } from './dian-enablement-inheritance-panel.component';

const NIT = '900123456';
const LEGAL = 'Aviso legal de prueba: el software pertenece a otro titular.';

function info(over: Partial<DianEnablementInheritance> = {}): DianEnablementInheritance {
  return {
    available: true,
    source_enablement_status: 'enabled',
    target_environment: 'production',
    issuer_nit: NIT,
    software_id: 'sw-1',
    legal_notice: LEGAL,
    ...over,
  };
}

describe('DianEnablementInheritancePanelComponent (UI)', () => {
  let api: jasmine.SpyObj<DianConfigApiService>;
  let toast: jasmine.SpyObj<ToastService>;

  async function mount(
    data: DianEnablementInheritance,
    inheritEnablement = true,
  ): Promise<ComponentFixture<DianEnablementInheritancePanelComponent>> {
    api = jasmine.createSpyObj<DianConfigApiService>('DianConfigApiService', [
      'getEnablementInheritance',
      'inheritEnablement',
    ]);
    api.getEnablementInheritance.and.returnValue(of({ success: true, data } as any));
    api.inheritEnablement.and.returnValue(of({}));
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);

    TestBed.configureTestingModule({
      imports: [DianEnablementInheritancePanelComponent],
      providers: [
        { provide: DianConfigApiService, useValue: api },
        { provide: ToastService, useValue: toast },
        {
          provide: DIAN_API_CONTEXT,
          useValue: {
            basePath: () => 'store/invoicing',
            capabilities: () => ({ ...ALL_DIAN_CAPABILITIES, inheritEnablement }),
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(DianEnablementInheritancePanelComponent);
    fixture.componentRef.setInput('configId', 7);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  const text = (f: ComponentFixture<unknown>): string => (f.nativeElement as HTMLElement).textContent ?? '';
  const button = (f: ComponentFixture<unknown>): HTMLButtonElement =>
    (f.nativeElement as HTMLElement).querySelector('app-button button') as HTMLButtonElement;

  it('does not render anything when available is false', async () => {
    const f = await mount(info({ available: false, reason: 'no_source' }));
    expect(api.getEnablementInheritance).toHaveBeenCalledOnceWith(7);
    expect((f.nativeElement as HTMLElement).querySelector('app-card')).toBeNull();
    expect(text(f).trim()).toBe('');
  });

  it('does not query nor render when the rail does not support inheritance', async () => {
    const f = await mount(info(), false);
    expect(api.getEnablementInheritance).not.toHaveBeenCalled();
    expect(text(f).trim()).toBe('');
  });

  it('shows the NIT and the legal notice when available', async () => {
    const f = await mount(info());
    const t = text(f);
    expect(t).toContain(`para el NIT ${NIT}`);
    expect(t).toContain(LEGAL);
    expect(t).toContain(`saldrán a nombre del NIT ${NIT}, dueño del software`);
    expect(t).toContain('producción');
  });

  it('keeps the button disabled until the checkbox is checked, then POSTs and emits inherited', async () => {
    const f = await mount(info());
    const emitted: unknown[] = [];
    f.componentInstance.inherited.subscribe(() => emitted.push(true));

    expect(button(f).disabled).toBeTrue();
    f.componentInstance.inherit();
    expect(api.inheritEnablement).not.toHaveBeenCalled();

    const checkbox = (f.nativeElement as HTMLElement).querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    f.detectChanges();
    expect(button(f).disabled).toBeFalse();

    button(f).click();
    f.detectChanges();
    expect(api.inheritEnablement).toHaveBeenCalledOnceWith(7);
    expect(toast.success).toHaveBeenCalled();
    expect(emitted.length).toBe(1);
  });

  it('shows the PIN mismatch message on DIAN_CONFIG_004 and does not emit', async () => {
    const f = await mount(info());
    api.inheritEnablement.and.returnValue(
      throwError(() => ({ status: 409, error: { error_code: 'DIAN_CONFIG_004', message: 'x' } })),
    );
    const emitted: unknown[] = [];
    f.componentInstance.inherited.subscribe(() => emitted.push(true));
    f.componentInstance.acknowledged.set(true);
    f.componentInstance.inherit();
    f.detectChanges();
    expect(text(f)).toContain('El PIN guardado no coincide con el del software ya habilitado');
    expect(emitted.length).toBe(0);
  });
});
