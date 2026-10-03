import { TestBed } from '@angular/core/testing';
import {
  AddressMapPickerComponent,
  RecenterControl,
} from './address-map-picker.component';

describe('RecenterControl', () => {
  let map: { flyTo: jasmine.Spy };
  let target: { lat: number; lng: number } | null;
  let control: RecenterControl;
  let root: HTMLDivElement;
  let button: HTMLButtonElement;

  beforeEach(() => {
    map = { flyTo: jasmine.createSpy('flyTo') };
    target = null;
    control = new RecenterControl(() => target);
    root = document.createElement('div');
    root.appendChild(control.onAdd(map));
    button = root.querySelector('button') as HTMLButtonElement;
  });

  it('starts disabled and does not move the map without a real address point', () => {
    expect(button.disabled).toBeTrue();
    expect(button.getAttribute('aria-label')).toBe('Centrar en la dirección');

    button.click();

    expect(map.flyTo).not.toHaveBeenCalled();
  });

  it('re-centers on the current marker at zoom 16 repeatedly, even when center is unchanged', () => {
    const center = { lat: 4.6, lng: -74.1 };
    const marker = { lat: 4.7, lng: -74.2 };
    target = marker;
    control.setEnabled(true);

    button.click();
    button.click();

    expect(map.flyTo).toHaveBeenCalledTimes(2);
    expect(map.flyTo).toHaveBeenCalledWith({ center: [marker.lng, marker.lat], zoom: 16 });
    expect(center).toEqual({ lat: 4.6, lng: -74.1 });
  });

  it('uses the geocoded center when no marker has been supplied', () => {
    const center = { lat: 4.6, lng: -74.1 };
    target = center;
    control.setEnabled(true);

    button.click();

    expect(map.flyTo).toHaveBeenCalledWith({ center: [center.lng, center.lat], zoom: 16 });
  });

  it('removes its click listener and DOM when removed', () => {
    target = { lat: 4.6, lng: -74.1 };
    control.setEnabled(true);
    control.onRemove();

    button.click();

    expect(root.contains(button)).toBeFalse();
    expect(map.flyTo).not.toHaveBeenCalled();
  });

  it('wires the component control to the latest marker before center without locating or GPS', () => {
    TestBed.configureTestingModule({ imports: [AddressMapPickerComponent] });
    const fixture = TestBed.createComponent(AddressMapPickerComponent);
    const component = fixture.componentInstance;
    const center = { lat: 4.6, lng: -74.1 };
    fixture.componentRef.setInput('center', center);

    let markerPosition = { lat: 4.7, lng: -74.2 };
    const componentInternals = component as unknown as {
      marker: { getLngLat: () => { lat: number; lng: number } } | null;
      createRecenterControl: () => RecenterControl;
    };
    componentInternals.marker = { getLngLat: () => markerPosition };
    const integratedControl = componentInternals.createRecenterControl();
    const integratedMap = { flyTo: jasmine.createSpy('flyTo') };
    const integratedRoot = document.createElement('div');
    integratedRoot.appendChild(integratedControl.onAdd(integratedMap));
    integratedControl.setEnabled(true);
    const integratedButton = integratedRoot.querySelector('button') as HTMLButtonElement;
    const located = jasmine.createSpy('located');
    component.located.subscribe(located);
    const getCurrentPosition = jasmine.createSpy('getCurrentPosition');
    const geolocationDescriptor = Object.getOwnPropertyDescriptor(navigator, 'geolocation');

    try {
      Object.defineProperty(navigator, 'geolocation', {
        configurable: true,
        value: { getCurrentPosition },
      });
      integratedButton.click();
      markerPosition = { lat: 4.8, lng: -74.3 };
      integratedButton.click();
    } finally {
      if (geolocationDescriptor) {
        Object.defineProperty(navigator, 'geolocation', geolocationDescriptor);
      } else {
        Reflect.deleteProperty(navigator, 'geolocation');
      }
      integratedControl.onRemove();
      fixture.destroy();
    }

    expect(integratedMap.flyTo).toHaveBeenCalledTimes(2);
    expect(integratedMap.flyTo).toHaveBeenCalledWith({ center: [-74.2, 4.7], zoom: 16 });
    expect(integratedMap.flyTo).toHaveBeenCalledWith({ center: [-74.3, 4.8], zoom: 16 });
    expect(located).not.toHaveBeenCalled();
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it('removes the old pin and disables recenter when the address center is cleared', () => {
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
    const integratedMap = {
      flyTo: jasmine.createSpy('flyTo'),
      remove: jasmine.createSpy('map.remove'),
    };
    const componentInternals = component as unknown as {
      map: typeof integratedMap | null;
      mapLoaded: boolean;
      marker: typeof marker | null;
      recenterControl: RecenterControl | null;
      createRecenterControl: () => RecenterControl;
    };
    componentInternals.map = integratedMap;
    componentInternals.mapLoaded = true;
    componentInternals.marker = marker;
    component.hasPoint.set(true);

    const integratedControl = componentInternals.createRecenterControl();
    componentInternals.recenterControl = integratedControl;
    const integratedRoot = document.createElement('div');
    integratedRoot.appendChild(integratedControl.onAdd(integratedMap));
    integratedControl.setEnabled(true);
    const integratedButton = integratedRoot.querySelector('button') as HTMLButtonElement;
    const located = jasmine.createSpy('located');
    component.located.subscribe(located);

    fixture.componentRef.setInput('center', null);
    fixture.detectChanges();

    expect(marker.remove).toHaveBeenCalledTimes(1);
    expect(componentInternals.marker).toBeNull();
    expect(component.hasPoint()).toBeFalse();
    expect(integratedButton.disabled).toBeTrue();
    expect(located).not.toHaveBeenCalled();
    expect(integratedMap.flyTo).not.toHaveBeenCalled();

    integratedControl.onRemove();
    fixture.destroy();
  });
});
