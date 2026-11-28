import { FormControl } from '@angular/forms';
import { Observable, Subject, of, throwError } from 'rxjs';
import {
  UsernameAvailability,
  usernameAvailabilityValidator,
} from './username-availability.validator';

describe('usernameAvailabilityValidator', () => {
  // The app is zoneless (no zone-testing), so fakeAsync is unavailable: drive
  // rxjs' timer() with the jasmine mock clock instead.
  const tick = (ms: number) => jasmine.clock().tick(ms);

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(2026, 0, 1));
  });

  afterEach(() => jasmine.clock().uninstall());

  function setup(
    response: Observable<UsernameAvailability> = of({ available: true }),
    options: Parameters<typeof usernameAvailabilityValidator>[1] = {},
  ) {
    const check = jasmine.createSpy('check').and.returnValue(response);
    const control = new FormControl('', {
      asyncValidators: usernameAvailabilityValidator(check, options),
      updateOn: 'change',
    });
    return { check, control };
  }

  it('does not call the API before 400 ms and calls it once after', () => {
    const { check, control } = setup();
    control.setValue('juan');
    tick(399);
    expect(check).not.toHaveBeenCalled();
    expect(control.pending).toBeTrue();
    tick(1);
    expect(check).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith('juan', undefined);
    expect(control.valid).toBeTrue();
  });

  it('cancels stale checks: fast successive values only query the last one', () => {
    const { check, control } = setup();
    control.setValue('jua');
    tick(200);
    control.setValue('juan');
    tick(200);
    control.setValue('juanp');
    tick(400);
    expect(check).toHaveBeenCalledTimes(1);
    expect(check).toHaveBeenCalledWith('juanp', undefined);
  });

  it('unsubscribes an in-flight request when the value changes', () => {
    const first = new Subject<UsernameAvailability>();
    const check = jasmine
      .createSpy('check')
      .and.returnValues(first, of({ available: true }));
    const control = new FormControl('', {
      asyncValidators: usernameAvailabilityValidator(check),
    });
    control.setValue('taken');
    tick(400);
    expect(first.observed).toBeTrue();
    control.setValue('free');
    expect(first.observed).toBeFalse();
    tick(400);
    first.next({ available: false, reason: 'taken' }); // late result is ignored
    expect(control.errors).toBeNull();
    expect(control.valid).toBeTrue();
  });

  it('skips empty and whitespace-only values without a request', () => {
    const { check, control } = setup();
    control.setValue('   ');
    tick(1000);
    expect(check).not.toHaveBeenCalled();
    expect(control.valid).toBeTrue();
  });

  it('skips values equal to the original (trimmed, case-insensitive)', () => {
    const { check, control } = setup(of({ available: true }), {
      originalValue: () => 'JuanPerez',
    });
    control.setValue('  juanperez ');
    tick(1000);
    expect(check).not.toHaveBeenCalled();
    expect(control.valid).toBeTrue();
  });

  it('trims the value and sends excludeUserId', () => {
    const { check, control } = setup(of({ available: true }), {
      originalValue: () => 'old',
      excludeUserId: () => 7,
    });
    control.setValue('  nuevo ');
    tick(400);
    expect(check).toHaveBeenCalledWith('nuevo', 7);
  });

  it('maps taken to { usernameTaken: true }', () => {
    const { control } = setup(of({ available: false, reason: 'taken' }));
    control.setValue('juan');
    tick(400);
    expect(control.errors).toEqual({ usernameTaken: true });
  });

  it('maps invalid to { usernameInvalid: true }', () => {
    const { control } = setup(of({ available: false, reason: 'invalid' }));
    control.setValue('x');
    tick(400);
    expect(control.errors).toEqual({ usernameInvalid: true });
  });

  it('maps available to null', () => {
    const { control } = setup(of({ available: true }));
    control.setValue('libre');
    tick(400);
    expect(control.errors).toBeNull();
  });

  it('does not block the user when the check fails', () => {
    const { control } = setup(throwError(() => new Error('network')));
    control.setValue('juan');
    tick(400);
    expect(control.errors).toBeNull();
    expect(control.valid).toBeTrue();
  });
});
