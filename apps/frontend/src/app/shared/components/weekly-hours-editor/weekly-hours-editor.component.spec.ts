import { TestBed } from '@angular/core/testing';
import { WeeklyHoursEditorComponent } from './weekly-hours-editor.component';
import { WeekHoursDay, weekFromBlockRows } from './weekly-hours.util';

describe('WeeklyHoursEditorComponent (editor de horario compartido)', () => {
  function setup(week: WeekHoursDay[], inputs: Record<string, unknown> = {}) {
    TestBed.configureTestingModule({ imports: [WeeklyHoursEditorComponent] });
    const fixture = TestBed.createComponent(WeeklyHoursEditorComponent);
    fixture.componentRef.setInput('days', week);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const dayEl = (dow: number) => el.querySelector(`[data-day="${dow}"]`) as HTMLElement;
    return { fixture, component: fixture.componentInstance, el, dayEl };
  }

  const monday9to6 = () => weekFromBlockRows([{ day_of_week: 1, start_time: '09:00', end_time: '18:00' }]);

  it('muestra un resumen simple y una tarjeta por día, de lunes a domingo', () => {
    const { el } = setup(monday9to6());
    expect(el.querySelector('[data-testid="week-summary"]')?.textContent).toContain('Lun 9 a. m. – 6 p. m. · Mar–Dom cerrado');
    expect(Array.from(el.querySelectorAll('[data-day]')).map((n) => n.getAttribute('data-day'))).toEqual(['1', '2', '3', '4', '5', '6', '0']);
  });

  it('el interruptor «24 horas» oculta los selectores y pinta la barra completa', () => {
    const { fixture, component, dayEl } = setup(monday9to6());
    expect(dayEl(1).querySelectorAll('select').length).toBe(2);
    component.toggle24h(1);
    fixture.detectChanges();
    expect(dayEl(1).querySelectorAll('select').length).toBe(0);
    expect(dayEl(1).textContent).toContain('Abierto 24 horas');
    const seg = dayEl(1).querySelector('.whe-bar__seg') as HTMLElement;
    expect(seg.style.width).toBe('100%');
  });

  it('un cierre menor que la apertura muestra «Termina al día siguiente» y pinta el desborde en el día siguiente', () => {
    const { fixture, el, dayEl } = setup(monday9to6());
    const close = dayEl(1).querySelectorAll('select')[1] as HTMLSelectElement;
    close.value = '02:00';
    close.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(dayEl(1).querySelector('[data-testid="ends-next-day"]')).not.toBeNull();
    expect(dayEl(2).querySelector('.whe-bar__seg--spill')).not.toBeNull();
    expect(el.querySelector('[data-testid="week-summary"]')?.textContent).toContain('(día siguiente)');
  });

  it('agrega y quita tramos, y copia un día a los días hábiles', () => {
    const { fixture, component, dayEl } = setup(monday9to6());
    component.addBlock(1);
    fixture.detectChanges();
    expect(dayEl(1).querySelectorAll('[data-block]').length).toBe(2);
    component.removeBlock(1, 1);
    component.toggleCopyMenu(1);
    fixture.detectChanges();
    (dayEl(1).querySelector('[data-copy="weekdays"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(component.week().filter((d) => d.is_active).map((d) => d.day_of_week)).toEqual([1, 2, 3, 4, 5]);
    expect(dayEl(6).classList).toContain('whe-day--closed');
  });

  it('el guardado solo emite una semana sin problemas', () => {
    const { fixture, component, el } = setup(monday9to6(), { showSave: true, requireOpenDay: true });
    const emitted: WeekHoursDay[][] = [];
    component.save.subscribe((w) => emitted.push(w));
    component.toggleOpen(1);
    fixture.detectChanges();
    expect(el.textContent).toContain('Abre al menos un día');
    component.onSave();
    expect(emitted.length).toBe(0);
    component.toggleOpen(1);
    component.onSave();
    expect(emitted.length).toBe(1);
  });

  it('en solo lectura no cambia nada', () => {
    const week = monday9to6();
    const { component, el } = setup(week, { readOnly: true });
    component.toggleOpen(1);
    component.applyPreset('always');
    expect(component.days()).toBe(week);
    expect(el.querySelector('select')).toBeNull();
  });
});
