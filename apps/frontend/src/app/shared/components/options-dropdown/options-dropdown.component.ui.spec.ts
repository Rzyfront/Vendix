import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { By } from '@angular/platform-browser';
import { OptionsDropdownComponent } from './options-dropdown.component';

describe('OptionsDropdownComponent accessible identity', () => {
  let fixture: ComponentFixture<OptionsDropdownComponent>;
  let component: OptionsDropdownComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OptionsDropdownComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    fixture = TestBed.createComponent(OptionsDropdownComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => TestBed.resetTestingModule());

  async function render(): Promise<void> {
    await fixture.whenStable();
  }

  function click(selector: string): void {
    (fixture.debugElement.query(By.css(selector)).nativeElement as HTMLButtonElement).click();
  }

  it('retains cloned actions by action id and emits changes from the native select filter', async () => {
    fixture.componentRef.setInput('debounceMs', 0);
    fixture.componentRef.setInput('actions', [{
      label: 'Exportar', icon: 'download', action: 'export',
    }]);
    fixture.componentRef.setInput('filters', [{
      key: 'status', label: 'Estado', type: 'select',
      options: [{ value: 'open', label: 'Abierto' }, { value: 'closed', label: 'Cerrado' }],
    }]);
    const actionClick = jasmine.createSpy('actionClick');
    const filterChange = jasmine.createSpy('filterChange');
    component.actionClick.subscribe(actionClick);
    component.filterChange.subscribe(filterChange);
    await render();

    click('.actions-trigger');
    await render();
    const actionButton = fixture.debugElement.query(By.css('.action-item')).nativeElement as HTMLButtonElement;
    fixture.componentRef.setInput('actions', [{
      label: 'Exportar CSV', icon: 'download', action: 'export',
    }]);
    await render();
    const refreshedButton = fixture.debugElement.query(By.css('.action-item')).nativeElement as HTMLButtonElement;
    expect(refreshedButton).toBe(actionButton);
    expect(refreshedButton.textContent).toContain('Exportar CSV');
    refreshedButton.click();
    expect(actionClick).toHaveBeenCalledOnceWith('export');

    click('.filters-trigger');
    await render();
    const select = fixture.debugElement.query(By.css('app-selector select')).nativeElement as HTMLSelectElement;
    select.selectedIndex = Array.from(select.options).findIndex((option) => option.textContent?.trim() === 'Cerrado');
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    await render();
    expect(filterChange).toHaveBeenCalledWith({ status: 'closed' });
  });

  it('associates same-key filter labels to distinct controls and exposes a clear aria-label', async () => {
    fixture.componentRef.setInput('filters', [{
      key: 'status', label: 'Estado', type: 'select',
      options: [{ value: 'open', label: 'Abierto' }],
    }]);
    fixture.componentRef.setInput('filterValues', { status: 'open' });
    const secondFixture = TestBed.createComponent(OptionsDropdownComponent);
    secondFixture.componentRef.setInput('filters', [{
      key: 'status', label: 'Estado', type: 'select',
      options: [{ value: 'open', label: 'Abierto' }],
    }]);
    try {
      await render();
      await secondFixture.whenStable();

      click('.filters-trigger');
      await render();
      const labelFor = (fixture.debugElement.query(By.css('.filter-label')).nativeElement as HTMLLabelElement).htmlFor;
      const selectId = (fixture.debugElement.query(By.css('app-selector select')).nativeElement as HTMLSelectElement).id;
      const clearButton = fixture.debugElement.query(By.css('.clear-filter-btn')).nativeElement as HTMLButtonElement;
      const clearAriaLabel = clearButton.getAttribute('aria-label');

      (secondFixture.debugElement.query(By.css('.filters-trigger')).nativeElement as HTMLButtonElement).click();
      await render();
      await secondFixture.whenStable();
      const secondLabelFor = (secondFixture.debugElement.query(By.css('.filter-label')).nativeElement as HTMLLabelElement).htmlFor;
      const secondSelectId = (secondFixture.debugElement.query(By.css('app-selector select')).nativeElement as HTMLSelectElement).id;

      expect(labelFor).toBe(selectId);
      expect(secondLabelFor).toBe(secondSelectId);
      expect(selectId).not.toBe(secondSelectId);
      expect(clearAriaLabel).toBe('Limpiar estado');
    } finally {
      secondFixture.destroy();
    }
  });
});
