import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { signal, WritableSignal } from '@angular/core';

import { PosEntregaStepComponent } from './pos-entrega-step.component';
import { PosRestaurantIntegrationService } from '../../../services/pos-restaurant-integration.service';

describe('PosEntregaStepComponent', () => {
  let fixture: ComponentFixture<PosEntregaStepComponent>;
  let component: PosEntregaStepComponent;
  let isRestaurant: WritableSignal<boolean>;

  beforeEach(async () => {
    isRestaurant = signal(false);

    const integrationMock = {
      isRestaurantMode: () => isRestaurant(),
      currentTableSession: () => null,
    };

    await TestBed.configureTestingModule({
      imports: [PosEntregaStepComponent],
      providers: [
        {
          provide: PosRestaurantIntegrationService,
          useValue: integrationMock,
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PosEntregaStepComponent);
    component = fixture.componentInstance;
  });

  describe('render Entrega', () => {
    it('muestra 2 opciones en tienda no-restaurante (Para llevar y Enviar)', () => {
      isRestaurant.set(false);
      fixture.detectChanges();

      const options = fixture.debugElement.queryAll(By.css('.option-row'));
      expect(options.length).toBe(2);
      expect(component.availableChoices()).toEqual(['llevar', 'enviar']);
    });

    it('muestra 3 opciones en tienda restaurante (Mesa, Para llevar y Enviar)', () => {
      isRestaurant.set(true);
      fixture.detectChanges();

      const options = fixture.debugElement.queryAll(By.css('.option-row'));
      expect(options.length).toBe(3);
      expect(component.availableChoices()).toEqual(['mesa', 'llevar', 'enviar']);
    });

    it('re-seleccionar opción mesa sin mesa abre el picker de mesa', () => {
      isRestaurant.set(true);
      fixture.detectChanges();

      component.onOptionClick('mesa');
      expect(component.choice()).toBe('mesa');
      expect(component.needsTable()).toBeTrue();

      // Re-click on already selected mesa
      component.onOptionClick('mesa');
      expect(component.openTablePicker()).toBeTrue();
    });

    it('seleccionar para llevar o enviar no requiere mesa y avanza en re-click', () => {
      let advanced = false;
      component.advanceRequested.subscribe(() => {
        advanced = true;
      });

      component.onOptionClick('llevar');
      expect(component.choice()).toBe('llevar');
      expect(component.needsTable()).toBeFalse();

      component.onOptionClick('llevar');
      expect(advanced).toBeTrue();
    });
  });
});
