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
    expect(fixture.nativeElement.textContent).toContain('offline');
  });

  it('uses server pagination and resets the page when searching', async () => {
    await setup();
    service.getProfiles.and.returnValue(of({ data: [profile], total: 51, page: 3, limit: 20 }));
    fixture.componentInstance.changePage(3);
    expect(service.getProfiles).toHaveBeenCalledWith(jasmine.objectContaining({ page: 3, limit: 20 }));
    expect(fixture.componentInstance.filters()).toEqual({ page: 3, limit: 20 });
    expect(fixture.componentInstance.page()).toBe(3);
    expect(fixture.componentInstance.limit()).toBe(20);
    expect(fixture.componentInstance.total()).toBe(51);
    expect(fixture.componentInstance.totalPages()).toBe(3);
    service.getProfiles.and.returnValue(of({ data: [profile], total: 51, page: 1, limit: 20 }));
    fixture.componentInstance.filters.update((filters) => ({ ...filters, page: 3 }));
    fixture.componentInstance.onSearch('obra 51');
    await new Promise((resolve) => setTimeout(resolve, 275));
    await fixture.whenStable();
    expect(service.getProfiles).toHaveBeenCalledWith(jasmine.objectContaining({ page: 1, search: 'obra 51' }));
    expect(fixture.componentInstance.filters()).toEqual({ page: 1, limit: 20 });
    expect(fixture.componentInstance.page()).toBe(1);
    expect(fixture.componentInstance.limit()).toBe(20);
    expect(fixture.nativeElement.querySelector('app-pagination')).toBeTruthy();
  });

  it('renders the standard stats/card/search/filter/data layout and actions dropdown', async () => {
    await setup();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll('app-stats').length).toBe(4);
    expect(root.querySelector('app-card')).toBeTruthy();
    expect(root.querySelector('app-inputsearch input')?.getAttribute('aria-label')).toBe('Buscar perfiles de cotización');
    expect(root.querySelector('app-options-dropdown')).toBeTruthy();
    expect(root.querySelector('app-responsive-data-view')).toBeTruthy();
    expect(root.querySelector('app-pagination')).toBeTruthy();
    expect(root.querySelector('app-alert-banner')?.textContent).toContain('no determinan');

    root.querySelector('app-options-dropdown button[aria-label="Acciones"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(root.textContent).toContain('Volver a cotizaciones');
    expect(root.textContent).toContain('Nuevo perfil');
  });

  it('keeps state dropdown, search, clear, and pagination synchronized', async () => {
    await setup();
    const component = fixture.componentInstance;
    component.changePage(3);
    component.onSearch('obra');
    component.onFilterChange({ state: 'inactive' });
    expect(component.search()).toBe('obra');
    expect(component.state()).toBe('inactive');
    expect(component.filterValues()).toEqual({ state: 'inactive' });
    expect(component.page()).toBe(1);
    expect(service.getProfiles).toHaveBeenCalledWith(jasmine.objectContaining({ page: 1, search: 'obra', state: 'inactive' }));

    component.changePage(2);
    component.clearFilters();
    expect(component.search()).toBe('');
    expect(component.state()).toBe('');
    expect(component.filterValues()).toEqual({ state: null });
    expect(component.page()).toBe(1);
    expect(component.filters()).toEqual({ page: 1, limit: 20 });
    expect(component.limit()).toBe(20);
    expect(service.getProfiles).toHaveBeenCalledWith(jasmine.objectContaining({ page: 1, search: undefined, state: undefined }));
  });

  it('backs up to the new last page when deleting the only row of page three', async () => {
    await setup();
    const secondPageRow = { ...profile, id: 40, name: 'Último perfil vigente' };
    service.getProfiles.and.returnValues(
      of({ data: [], total: 40, page: 3, limit: 20 }),
      of({ data: [secondPageRow], total: 40, page: 2, limit: 20 }),
    );
    fixture.componentInstance.filters.update((filters) => ({ ...filters, page: 3 }));
    fixture.componentInstance.load();
    fixture.detectChanges();

    expect(service.getProfiles).toHaveBeenCalledWith(jasmine.objectContaining({ page: 3, limit: 20 }));
    expect(service.getProfiles).toHaveBeenCalledWith(jasmine.objectContaining({ page: 2, limit: 20 }));
    expect(fixture.componentInstance.page()).toBe(2);
    expect(fixture.componentInstance.profiles()).toEqual([secondPageRow]);
    expect(fixture.nativeElement.textContent).toContain('Último perfil vigente');
    expect(fixture.nativeElement.textContent).not.toContain('Aún no hay perfiles');
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

  it('bridges clone form status to the button and guards Escape while cloning, then allows cancel and clean reopen', async () => {
    await setup();
    const component = fixture.componentInstance;
    component.openClone(profile);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const cloneDialog = Array.from(root.querySelectorAll('[role="dialog"]')).find((dialog) => dialog.textContent?.includes('Clonar perfil'));
    expect(cloneDialog?.getAttribute('aria-modal')).toBe('true');
    expect(cloneDialog?.getAttribute('aria-labelledby')).toBeTruthy();
    const cloneButton = Array.from(cloneDialog?.querySelectorAll('button') ?? []).find((button) => button.textContent?.includes('Clonar')) as HTMLButtonElement;
    expect(cloneButton.disabled).toBeFalse();
    component.cloneForm.controls.name.setValue('');
    component.cloneForm.controls.name.markAsTouched();
    await fixture.whenStable();
    expect(component.cloneNameError()).toBe('El nombre es obligatorio.');
    expect(cloneDialog?.textContent).toContain('El nombre es obligatorio.');
    component.cloneForm.controls.name.setValue('x'.repeat(151));
    component.cloneForm.controls.name.markAsTouched();
    await fixture.whenStable();
    expect(component.cloneNameError()).toBe('Máximo 150 caracteres.');
    expect(cloneDialog?.textContent).toContain('Máximo 150 caracteres.');

    component.cloneForm.controls.name.setValue('Copia válida');
    await fixture.whenStable();
    expect(cloneButton.disabled).toBeFalse();

    const pendingClone = new Subject<QuotationProfile>();
    service.clone.and.returnValue(pendingClone);
    component.clone();
    await fixture.whenStable();
    expect(component.cloneLoading()).toBeTrue();
    expect(cloneButton.disabled).toBeTrue();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(component.cloneOpen()).toBeTrue();
    component.clone();
    expect(service.clone).toHaveBeenCalledTimes(1);

    pendingClone.error(new Error('fallo de red'));
    await fixture.whenStable();
    expect(component.cloneLoading()).toBeFalse();
    expect(component.cloneError()).toContain('fallo de red');
    const cancelButton = Array.from(cloneDialog?.querySelectorAll('button') ?? []).find((button) => button.textContent?.includes('Cancelar')) as HTMLButtonElement;
    cancelButton.click();
    await fixture.whenStable();
    expect(component.cloneOpen()).toBeFalse();
    component.openClone(profile);
    await fixture.whenStable();
    expect(component.cloneError()).toBe('');
    expect(component.cloneForm.controls.name.value).toBe('Obra (copia)');
  });

  it('does not fetch or show profile actions when read permission is missing', async () => {
    await setup({});
    expect(service.getProfiles).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('No tienes permiso');
    expect(fixture.componentInstance.tableActions().some((action) => action.show?.(profile))).toBeFalse();
  });

  it('loads version history and supports a later server page', async () => {
    await setup();
    service.getVersions.and.returnValues(
      of({ data: [], total: 41, page: 1, limit: 20 }),
      of({ data: [], total: 41, page: 2, limit: 20 }),
    );
    fixture.componentInstance.toggleVersions(profile);
    expect(service.getVersions).toHaveBeenCalledWith(8, 1, 20);
    fixture.componentInstance.loadVersions(8, 2);
    expect(service.getVersions).toHaveBeenCalledWith(8, 2, 20);
    expect(fixture.componentInstance.versionsFilters()).toEqual({ page: 2, limit: 20 });
    expect(fixture.componentInstance.versionsPage()).toBe(2);
    expect(fixture.componentInstance.versionsLimit()).toBe(20);
    expect(fixture.componentInstance.versionsTotalPages()).toBe(3);
  });

  it('renders version history in its own responsive card with readable configuration', async () => {
    await setup();
    service.getVersions.and.returnValue(of({
      data: [{ id: 2, version: 2, config: { admin_percent: 0, payment_terms: 'Anticipo 50%' }, created_at: '2026-01-02T12:30:00Z' }],
      total: 1, page: 1, limit: 20,
    }));
    fixture.componentInstance.toggleVersions(profile);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.textContent).toContain('Historial de versiones');
    expect(root.textContent).toContain('Configuración guardada');
    expect(root.querySelectorAll('app-responsive-data-view').length).toBe(2);
    fixture.componentInstance.versionActions[0].action(fixture.componentInstance.versions()[0]);
    fixture.detectChanges();
    expect(root.textContent).toContain('Anticipo 50%');
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
