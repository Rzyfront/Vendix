import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';
import { StickyHeaderComponent } from './sticky-header.component';

describe('StickyHeaderComponent action identity and accessibility', () => {
  let fixture: ComponentFixture<StickyHeaderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StickyHeaderComponent],
      providers: [provideZonelessChangeDetection(), provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(StickyHeaderComponent);
    fixture.componentRef.setInput('title', 'Contratos');
  });

  afterEach(() => TestBed.resetTestingModule());

  async function render(): Promise<void> {
    await fixture.whenStable();
  }

  it('retains an action button for cloned action inputs and updates its state and accessible label', async () => {
    fixture.componentRef.setInput('actions', [{
      id: 'save', label: 'Guardar', variant: 'primary', icon: 'save',
    }]);
    await render();
    const button = fixture.debugElement.query(By.css('app-button button')).nativeElement;

    fixture.componentRef.setInput('actions', [{
      id: 'save', label: 'Guardar cambios', variant: 'primary', icon: 'save',
      disabled: true, loading: true,
    }]);
    await render();

    const refreshedButton = fixture.debugElement.query(By.css('app-button button')).nativeElement;
    expect(refreshedButton).toBe(button);
    expect(button.getAttribute('aria-label')).toBe('Guardar cambios');
    expect(button.disabled).toBeTrue();
    expect(button.querySelector('svg.animate-spin')).not.toBeNull();
  });

  it('exposes the back button accessible name on the native button', async () => {
    fixture.componentRef.setInput('showBackButton', true);
    await render();

    const backButton = fixture.debugElement.query(By.css('app-button button')).nativeElement;
    expect(backButton.getAttribute('aria-label')).toBe('Volver');
  });
});
