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
});
