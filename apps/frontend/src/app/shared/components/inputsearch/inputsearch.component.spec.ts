import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { By } from '@angular/platform-browser';
import { InputsearchComponent } from './inputsearch.component';

describe('InputsearchComponent zoneless CVA state', () => {
  let fixture: ComponentFixture<InputsearchComponent>;
  let component: InputsearchComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [InputsearchComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    fixture = TestBed.createComponent(InputsearchComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => TestBed.resetTestingModule());

  it('renders CVA disabled/value updates without forced change detection and names the clear button', async () => {
    const cleared = jasmine.createSpy('cleared');
    component.clear.subscribe(cleared);
    component.setDisabledState(true);
    component.writeValue('coffee');
    await fixture.whenStable();

    const input = fixture.debugElement.query(By.css('input')).nativeElement as HTMLInputElement;
    let clearButton = fixture.debugElement.query(By.css('.inputsearch-clear')).nativeElement as HTMLButtonElement;
    expect(input.disabled).toBeTrue();
    expect(input.value).toBe('coffee');
    expect(clearButton.disabled).toBeTrue();
    expect(clearButton.getAttribute('aria-label')).toBe('Limpiar búsqueda');

    component.setDisabledState(false);
    await fixture.whenStable();
    clearButton = fixture.debugElement.query(By.css('.inputsearch-clear')).nativeElement as HTMLButtonElement;
    clearButton.click();
    await fixture.whenStable();

    expect((fixture.debugElement.query(By.css('input')).nativeElement as HTMLInputElement).value).toBe('');
    expect(cleared).toHaveBeenCalledTimes(1);
  });
});
