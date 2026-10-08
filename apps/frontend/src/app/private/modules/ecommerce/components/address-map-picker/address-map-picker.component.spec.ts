import { TestBed } from '@angular/core/testing';
import { AddressMapPickerComponent } from './address-map-picker.component';

describe('AddressMapPickerComponent', () => {
  it('clears the old pin when the address center is cleared', () => {
    TestBed.configureTestingModule({ imports: [AddressMapPickerComponent] });
    const fixture = TestBed.createComponent(AddressMapPickerComponent);
    const component = fixture.componentInstance;
    spyOn(component, 'ngAfterViewInit').and.stub();
    fixture.componentRef.setInput('center', { lat: 11.5496, lng: -72.9105 });
    fixture.detectChanges();

    const marker = {
      getLngLat: () => ({ lat: 11.5496, lng: -72.9105 }),
      remove: jasmine.createSpy('marker.remove'),
    };
    const map = {
      flyTo: jasmine.createSpy('flyTo'),
      remove: jasmine.createSpy('map.remove'),
    };
    const internals = component as unknown as {
      map: typeof map | null;
      mapLoaded: boolean;
      marker: typeof marker | null;
    };
    internals.map = map;
    internals.mapLoaded = true;
    internals.marker = marker;
    component.hasPoint.set(true);
    const located = jasmine.createSpy('located');
    component.located.subscribe(located);

    fixture.componentRef.setInput('center', null);
    fixture.detectChanges();

    expect(marker.remove).toHaveBeenCalledTimes(1);
    expect(internals.marker).toBeNull();
    expect(component.hasPoint()).toBeFalse();
    expect(located).not.toHaveBeenCalled();
    expect(map.flyTo).not.toHaveBeenCalled();
    fixture.destroy();
  });

  it('only emits the delegated GPS request after the operator clicks the GPS button', () => {
    TestBed.configureTestingModule({ imports: [AddressMapPickerComponent] });
    const fixture = TestBed.createComponent(AddressMapPickerComponent);
    const component = fixture.componentInstance;
    spyOn(component, 'ngAfterViewInit').and.stub();
    const internals = component as unknown as {
      createLocateButtonControl: () => { onAdd: () => HTMLElement; onRemove: () => void };
    };
    const control = internals.createLocateButtonControl();
    const root = document.createElement('div');
    root.appendChild(control.onAdd());
    const button = root.querySelector('button') as HTMLButtonElement;
    const locateRequested = jasmine.createSpy('locateRequested');
    component.locateRequested.subscribe(locateRequested);
    const getCurrentPosition = jasmine.createSpy('getCurrentPosition');
    const geolocationDescriptor = Object.getOwnPropertyDescriptor(navigator, 'geolocation');

    try {
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: { getCurrentPosition },
      });
      expect(button.getAttribute('aria-label')).toBe('Usar mi ubicación actual');
      expect(locateRequested).not.toHaveBeenCalled();
      expect(getCurrentPosition).not.toHaveBeenCalled();

      button.click();

      expect(locateRequested).toHaveBeenCalledTimes(1);
      expect(getCurrentPosition).not.toHaveBeenCalled();
    } finally {
      if (geolocationDescriptor) {
        Object.defineProperty(navigator, 'geolocation', geolocationDescriptor);
      } else {
        Reflect.deleteProperty(navigator, 'geolocation');
      }
      control.onRemove();
      fixture.destroy();
    }
  });
  describe('map failure placeholder', () => {
    function setup() {
      TestBed.configureTestingModule({ imports: [AddressMapPickerComponent] });
      const fixture = TestBed.createComponent(AddressMapPickerComponent);
      const component = fixture.componentInstance;
      spyOn(component, 'ngAfterViewInit').and.stub();
      const fail = () =>
        (component as unknown as { failMap: () => void }).failMap();
      return { fixture, component, fail };
    }

    it('shows the actionable text and the locate button', () => {
      const { fixture, fail } = setup();
      fixture.detectChanges();
      fail();
      fixture.detectChanges();

      const el = fixture.nativeElement as HTMLElement;
      const text = el.querySelector('.amp-error')?.textContent ?? '';
      expect(text).toContain(
        'No pudimos mostrar el mapa. Usa tu ubicación para ubicar la entrega.',
      );
      expect(text).not.toContain('manualmente');
      expect(el.querySelector('.amp-error-btn')?.textContent).toContain(
        'Usar mi ubicación',
      );
      fixture.destroy();
    });

    it('emits locateRequested when the button is clicked with delegateLocate', () => {
      const { fixture, component, fail } = setup();
      fixture.componentRef.setInput('delegateLocate', true);
      fixture.detectChanges();
      fail();
      fixture.detectChanges();
      const locateRequested = jasmine.createSpy('locateRequested');
      component.locateRequested.subscribe(locateRequested);

      (
        fixture.nativeElement.querySelector('.amp-error-btn') as HTMLButtonElement
      ).click();

      expect(locateRequested).toHaveBeenCalledTimes(1);
      fixture.destroy();
    });

    it('emits mapFailed (and mapReady) only once on the error path', () => {
      const { fixture, component, fail } = setup();
      const mapFailed = jasmine.createSpy('mapFailed');
      const mapReady = jasmine.createSpy('mapReady');
      component.mapFailed.subscribe(mapFailed);
      component.mapReady.subscribe(mapReady);

      fail();
      fail();

      expect(component.error()).toBeTrue();
      expect(mapFailed).toHaveBeenCalledTimes(1);
      expect(mapReady).toHaveBeenCalledTimes(1);
      fixture.destroy();
    });
  });
});
