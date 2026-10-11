import { TestBed } from '@angular/core/testing';
import { ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { DialogService } from '../../../../../../shared/components/dialog/dialog.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import { QuotationProfile } from '../../interfaces/quotation-profile.interface';
import { QuotationProfilesService } from '../../services/quotation-profiles.service';
import { QuotationProfilesComponent } from './quotation-profiles.component';

const profile: QuotationProfile = {
  id: 8, name: 'Obra', state: 'active', is_default: false, current_version: 2,
  current_config: { admin_percent: 0 }, created_at: '2026-01-01', updated_at: '2026-01-02',
};
const page = { data: [profile], total: 51, page: 1, limit: 20 };

describe('QuotationProfilesComponent', () => {
  let service: jasmine.SpyObj<QuotationProfilesService>;
  let auth: { hasPermission: jasmine.Spy };
  let fixture: ComponentFixture<QuotationProfilesComponent>;

  const setup = async (permissionMap: Record<string, boolean> = { 'store:quotations:read': true, 'store:quotations:read:one': true, 'store:quotations:create': true, 'store:quotations:update': true, 'store:quotations:delete': true }) => {
    service = jasmine.createSpyObj<QuotationProfilesService>('QuotationProfilesService', ['getProfiles', 'getProfile', 'getVersions', 'create', 'update', 'clone', 'setDefault', 'setActive', 'remove', 'getCatalog', 'invalidateCache']);
    service.getProfiles.and.returnValue(of(page));
    service.getProfile.and.returnValue(of(profile));
    service.getVersions.and.returnValue(of({ data: [], total: 0, page: 1, limit: 20 }));
    service.clone.and.returnValue(of(profile));
    service.setDefault.and.returnValue(of({}));
    service.setActive.and.returnValue(of({}));
    service.remove.and.returnValue(of({}));
    auth = { hasPermission: jasmine.createSpy().and.callFake((permission: string) => permissionMap[permission] ?? false) };

    await TestBed.configureTestingModule({
      imports: [QuotationProfilesComponent],
      providers: [
        provideRouter([]),
        { provide: QuotationProfilesService, useValue: service },
        { provide: AuthFacade, useValue: auth },
        { provide: CurrencyFormatService, useValue: { currencyFormatStyle: () => 'dot_comma', currencyDecimals: () => 2, format: (value: number) => String(value), loadCurrency: () => undefined } },
        { provide: ToastService, useValue: { success: jasmine.createSpy(), error: jasmine.createSpy(), info: jasmine.createSpy() } },
        { provide: DialogService, useValue: { confirm: jasmine.createSpy().and.resolveTo(true) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(QuotationProfilesComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('compiles and renders the real empty and error states separately', async () => {
    await setup();
    expect(fixture.nativeElement.textContent).toContain('Obra');

    service.getProfiles.and.returnValue(of({ data: [], total: 0, page: 1, limit: 20 }));
    fixture.componentInstance.load();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Aún no hay perfiles');

    service.getProfiles.and.returnValue(throwError(() => new Error('offline')));
    fixture.componentInstance.load();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('offline');
  });

  it('uses server pagination and resets the page when searching', async () => {
    await setup();
    fixture.componentInstance.changePage(3);
    expect(service.getProfiles).toHaveBeenCalledWith(jasmine.objectContaining({ page: 3, limit: 20 }));
    fixture.componentInstance.page.set(3);
    fixture.componentInstance.onSearch('obra 51');
    await new Promise((resolve) => setTimeout(resolve, 275));
    await fixture.whenStable();
    expect(service.getProfiles).toHaveBeenCalledWith(jasmine.objectContaining({ page: 1, search: 'obra 51' }));
    expect(fixture.nativeElement.querySelector('app-pagination')).toBeTruthy();
  });

  it('ignores stale list responses and clears a pending search timer on destroy', async () => {
    await setup();
    const component = fixture.componentInstance;
    const older = new Subject<typeof page>();
    const newer = new Subject<typeof page>();
    service.getProfiles.and.returnValues(older, newer);
    component.load();
    component.search.set('fresh');
    component.load();
    older.next({ ...page, data: [{ ...profile, name: 'Stale' }] });
    newer.next({ ...page, data: [{ ...profile, name: 'Fresh' }] });
    expect(component.profiles()[0].name).toBe('Fresh');

    const callCount = service.getProfiles.calls.count();
    component.onSearch('never sent');
    component.ngOnDestroy();
    await new Promise((resolve) => setTimeout(resolve, 275));
    expect(service.getProfiles.calls.count()).toBe(callCount);
  });

  it('shows clone only for create permission, edit only for update plus read:one, and guards direct clone calls', async () => {
    await setup({ 'store:quotations:read': true, 'store:quotations:create': true, 'store:quotations:update': false, 'store:quotations:read:one': false });
    const actions = fixture.componentInstance.tableActions();
    const clone = actions.find((action) => action.label === 'Clonar')!;
    const edit = actions.find((action) => action.label === 'Editar')!;
    expect(clone.show?.(profile)).toBeTrue();
    expect(edit.show?.(profile)).toBeFalse();

    fixture.componentInstance.openClone(profile);
    expect(fixture.componentInstance.cloneOpen()).toBeTrue();
    fixture.componentInstance.cloneForm.controls.name.setValue('  Copia  ');
    fixture.componentInstance.clone();
    expect(service.clone).toHaveBeenCalledWith(8, 'Copia');

    auth.hasPermission.and.returnValue(false);
    fixture.componentInstance.setDefault(profile);
    expect(service.setDefault).not.toHaveBeenCalled();
    fixture.componentInstance.openClone(profile);
    fixture.componentInstance.clone();
    expect(service.clone).toHaveBeenCalledTimes(1);
  });

  it('does not fetch or show profile actions when read permission is missing', async () => {
    await setup({});
    expect(service.getProfiles).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('No tienes permiso');
    expect(fixture.componentInstance.tableActions().some((action) => action.show?.(profile))).toBeFalse();
  });

  it('loads version history and supports a later server page', async () => {
    await setup();
    service.getVersions.and.returnValue(of({ data: [], total: 41, page: 1, limit: 20 }));
    fixture.componentInstance.toggleVersions(profile);
    expect(service.getVersions).toHaveBeenCalledWith(8, 1, 20);
    fixture.componentInstance.loadVersions(8, 2);
    expect(service.getVersions).toHaveBeenCalledWith(8, 2, 20);
    expect(fixture.componentInstance.versionsTotalPages()).toBe(3);
  });

  it('ignores a late history response after switching from profile A to profile B', async () => {
    await setup();
    const component = fixture.componentInstance;
    const historyA = new Subject<{ data: any[]; total: number; page: number; limit: number }>();
    const historyB = new Subject<{ data: any[]; total: number; page: number; limit: number }>();
    const profileB = { ...profile, id: 9, name: 'Perfil B' };
    service.getVersions.and.returnValues(historyA, historyB);

    component.toggleVersions(profile);
    component.toggleVersions(profileB);
    historyA.next({ data: [{ id: 1, version: 1, config: { notes: 'A' }, created_at: '2026-01-01' }], total: 1, page: 1, limit: 20 });
    expect(component.expandedId()).toBe(9);
    expect(component.versions()).toEqual([]);
    expect(component.versionsLoading()).toBeTrue();

    historyB.next({ data: [{ id: 2, version: 2, config: { notes: 'B' }, created_at: '2026-01-02' }], total: 1, page: 1, limit: 20 });
    historyB.complete();
    expect(component.versions()[0].config.notes).toBe('B');
    expect(component.versionsLoading()).toBeFalse();
  });
});
