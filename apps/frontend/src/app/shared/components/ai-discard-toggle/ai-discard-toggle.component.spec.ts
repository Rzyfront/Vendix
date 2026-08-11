import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AiDiscardToggleComponent } from './ai-discard-toggle.component';

/**
 * QUI-644 — contrato del botón de descarte.
 *
 * Se prueba acá y no por navegador porque el control vive en el paso 3 de los
 * escáneres, que exige una pasada real de IA: en dev no hay proveedor
 * configurado (`INV_SCAN_AI_FAIL`), así que ese paso es inalcanzable. Lo que sí
 * es verificable —y es lo que el ticket especifica— es el contrato del toggle:
 * refleja el estado, lo anuncia, y NO lo guarda.
 */
@Component({
  standalone: true,
  imports: [AiDiscardToggleComponent],
  template: `
    <app-ai-discard-toggle
      [discarded]="discarded()"
      [label]="label"
      (toggled)="onToggled()"
    ></app-ai-discard-toggle>
  `,
})
class HostComponent {
  readonly discarded = signal(false);
  label = 'Camiseta azul';
  toggles = 0;

  onToggled(): void {
    this.toggles++;
    this.discarded.set(!this.discarded());
  }
}

describe('AiDiscardToggleComponent (QUI-644)', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const button = (): HTMLButtonElement =>
    fixture.nativeElement.querySelector('button');

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('es un <button> real con aria-pressed, no un ícono clickeable', () => {
    expect(button()).toBeTruthy();
    expect(button().getAttribute('aria-pressed')).toBe('false');
  });

  it('anuncia la acción con el nombre del ítem', () => {
    expect(button().getAttribute('aria-label')).toBe('Descartar Camiseta azul');
  });

  it('emite el toggle sin guardar estado propio: el consumidor es el dueño', () => {
    button().click();
    fixture.detectChanges();

    expect(host.toggles).toBe(1);
    expect(host.discarded()).toBeTrue();
    // El componente refleja el estado del host, que es quien lo movió.
    expect(button().getAttribute('aria-pressed')).toBe('true');
  });

  it('al estar descartado ofrece restaurar, no descartar de nuevo', () => {
    host.discarded.set(true);
    fixture.detectChanges();

    expect(button().getAttribute('aria-label')).toBe('Restaurar Camiseta azul');
  });

  it('vuelve a activo con un segundo clic (es un toggle, no un borrado)', () => {
    button().click();
    fixture.detectChanges();
    button().click();
    fixture.detectChanges();

    expect(host.toggles).toBe(2);
    expect(host.discarded()).toBeFalse();
    expect(button().getAttribute('aria-pressed')).toBe('false');
  });
});
