import { RecenterControl } from './address-map-picker.component';

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

  it('uses the geocoded center when no marker has been supplied and emits no location event', () => {
    const center = { lat: 4.6, lng: -74.1 };
    const located = jasmine.createSpy('located');
    target = center;
    control.setEnabled(true);

    button.click();

    expect(map.flyTo).toHaveBeenCalledWith({ center: [center.lng, center.lat], zoom: 16 });
    expect(located).not.toHaveBeenCalled();
  });

  it('removes its click listener and DOM when removed', () => {
    target = { lat: 4.6, lng: -74.1 };
    control.setEnabled(true);
    control.onRemove();

    button.click();

    expect(root.contains(button)).toBeFalse();
    expect(map.flyTo).not.toHaveBeenCalled();
  });
});
