import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { of } from 'rxjs';

import { StoreUserSelectComponent } from './store-user-select.component';
import {
  StoreUserLookupService,
  StoreUserOption,
} from '../../services/store-user-lookup.service';

/**
 * Regresión: el `effect` `syncValueInput` leía `this.selected()` sin
 * `untracked`, así que quedaba suscrito a esa señal. En modo CVA
 * (`formControlName`, sin `[value]`) `value()` nunca se enlaza y permanece en
 * `null`; cada `writeValue()`/`select()` que hacía `selected.set(user)`
 * re-disparaba el effect, que veía `id == null` y ejecutaba
 * `selected.set(null)` de inmediato — la selección desaparecía en las 5
 * pantallas que usan el componente como CVA (store-role-users-panel,
 * dispatch-notes route-step, planilla-wizard, generate-dispatch-wizard,
 * vehicle-form-modal). Solo payment-collector, que sí enlaza `[value]`, se
 * libraba por accidente porque ahí `value()` no es siempre `null`.
 *
 * El fix hace que el effect dependa SOLO de `this.value()` (lee `selected()`
 * con `untracked`) y agrega una bandera privada (`receivedValueInput`, campo
 * plano — no señal, para no crear una dependencia nueva del effect) que lo
 * vuelve no-op mientras `[value]` nunca haya traído un id no nulo.
 *
 * Corre zoneless — el arnés provee `provideZonelessChangeDetection()` en la
 * raíz del TestBed (`src/test-init.ts`) — así que se usa
 * `await fixture.whenStable()` como equivalente de `tick()` para vaciar el
 * effect y la resolución async de `getById`.
 *
 * Skills: `vendix-zoneless-signals`, `vendix-angular-forms`, `vendix-known-errors`.
 */
const USER_7: StoreUserOption = { id: 7, name: 'Ana Pérez', email: 'ana@vendix.test' };
const USER_9: StoreUserOption = { id: 9, name: 'Luis Gómez', email: 'luis@vendix.test' };

function makeLookupSpy(): jasmine.SpyObj<StoreUserLookupService> {
  const spy = jasmine.createSpyObj<StoreUserLookupService>('StoreUserLookupService', [
    'search',
    'getById',
  ]);
  spy.search.and.returnValue(of([]));
  spy.getById.and.callFake((id: number) =>
    of(id === USER_7.id ? USER_7 : id === USER_9.id ? USER_9 : null),
  );
  return spy;
}

// ── Modo CVA: formControlName, sin [value] ──────────────────────────────────
@Component({
  standalone: true,
  imports: [StoreUserSelectComponent, ReactiveFormsModule],
  template: `<app-store-user-select [formControl]="control" />`,
})
class CvaHostComponent {
  readonly control = new FormControl<number | null>(null);
}

// ── Modo [value]: payment-collector (plain signal, no CVA) ─────────────────
@Component({
  standalone: true,
  imports: [StoreUserSelectComponent],
  template: `<app-store-user-select [value]="tipWaiterId()" (valueChange)="onValueChange($event)" />`,
})
class ValueInputHostComponent {
  readonly tipWaiterId = signal<number | null>(null);
  readonly changes: (number | null)[] = [];

  onValueChange(id: number | null): void {
    this.changes.push(id);
  }
}

describe('StoreUserSelectComponent · syncValueInput no pisa el estado CVA (B9 regresión)', () => {
  let lookupSpy: jasmine.SpyObj<StoreUserLookupService>;

  beforeEach(() => {
    lookupSpy = makeLookupSpy();
  });

  describe('modo CVA (formControlName, [value] nunca enlazado)', () => {
    let fixture: ComponentFixture<CvaHostComponent>;
    let host: CvaHostComponent;
    let component: StoreUserSelectComponent;

    beforeEach(async () => {
      await TestBed.configureTestingModule({
        imports: [CvaHostComponent],
        providers: [{ provide: StoreUserLookupService, useValue: lookupSpy }],
      }).compileComponents();

      fixture = TestBed.createComponent(CvaHostComponent);
      host = fixture.componentInstance;
      fixture.detectChanges();
      await fixture.whenStable();

      component = fixture.debugElement.children[0].componentInstance;
    });

    it('writeValue(7) resuelve el usuario y la selección persiste tras el effect', async () => {
      host.control.setValue(7);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.selected()?.id).toBe(7);
      expect(component.selected()?.name).toBe('Ana Pérez');
    });

    it('select(user) persiste: el effect ya no la borra en el siguiente ciclo', async () => {
      component.select(USER_9);
      fixture.detectChanges();
      await fixture.whenStable();

      // Segunda vuelta de detección de cambios: si el effect todavía dependiera
      // de `selected()`, este es el punto donde volvería a dispararse y
      // ejecutaría `selected.set(null)` porque `value()` sigue en `null`.
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.selected()?.id).toBe(9);
      expect(host.control.value).toBe(9);
    });

    it('writeValue(null) explícito sí limpia la selección', async () => {
      host.control.setValue(7);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(component.selected()?.id).toBe(7);

      host.control.setValue(null);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.selected()).toBeNull();
    });
  });

  describe('modo [value] (payment-collector, plain signal sin FormControl)', () => {
    let fixture: ComponentFixture<ValueInputHostComponent>;
    let host: ValueInputHostComponent;
    let component: StoreUserSelectComponent;

    beforeEach(async () => {
      await TestBed.configureTestingModule({
        imports: [ValueInputHostComponent],
        providers: [{ provide: StoreUserLookupService, useValue: lookupSpy }],
      }).compileComponents();

      fixture = TestBed.createComponent(ValueInputHostComponent);
      host = fixture.componentInstance;
      fixture.detectChanges();
      await fixture.whenStable();

      component = fixture.debugElement.children[0].componentInstance;
    });

    it('arranca sin seleccionar nada (value inicial null, nunca se recibió un id)', () => {
      expect(component.selected()).toBeNull();
    });

    it('setInput a un id resuelve el nombre', async () => {
      host.tipWaiterId.set(7);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.selected()?.id).toBe(7);
      expect(component.selected()?.name).toBe('Ana Pérez');
    });

    it('volver a null tras haber tenido un id sí limpia la selección', async () => {
      host.tipWaiterId.set(7);
      fixture.detectChanges();
      await fixture.whenStable();
      expect(component.selected()?.id).toBe(7);

      host.tipWaiterId.set(null);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(component.selected()).toBeNull();
    });
  });
});
