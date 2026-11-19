import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HomePanelHostComponent } from './home-panel-host.component';
import { HomePanelService } from './home-panel.service';
import { HomePanelDefinition } from './home-panel.registry';
import { HomePanelId } from '../../../../../shared/constants/home-panels';

@Component({ selector: 'app-dummy-panel', standalone: true, template: 'dummy-panel' })
class DummyPanelComponent {}

describe('HomePanelHostComponent (QUI-967)', () => {
  let tabs: ReturnType<typeof signal<HomePanelDefinition[]>>;
  let loaders: Record<string, jasmine.Spy>;

  const makeTab = (id: HomePanelId, title: string, route?: string): HomePanelDefinition => {
    loaders[id] = jasmine
      .createSpy(`load-${id}`)
      .and.callFake(() => Promise.resolve(DummyPanelComponent));
    return {
      id,
      title,
      icon: 'layout-dashboard',
      description: '',
      moduleKeys: [],
      permissions: [],
      route,
      loadComponent: loaders[id],
    };
  };

  const create = async (): Promise<ComponentFixture<HomePanelHostComponent>> => {
    const fixture = TestBed.createComponent(HomePanelHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  };

  beforeEach(() => {
    loaders = {};
    tabs = signal<HomePanelDefinition[]>([]);
    TestBed.configureTestingModule({
      imports: [HomePanelHostComponent],
      providers: [
        provideRouter([]),
        { provide: HomePanelService, useValue: { visibleTabs: tabs } },
      ],
    });
  });

  it('con una sola pestaña (Resumen) no muestra barra ni enlace', async () => {
    tabs.set([makeTab('summary', 'Resumen')]);
    const fixture = await create();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[role="tablist"]')).toBeNull();
    expect(el.textContent).not.toContain('Abrir módulo completo');
    expect(el.textContent).toContain('dummy-panel');
  });

  it('con varias pestañas muestra la barra en orden y solo carga la activa', async () => {
    tabs.set([
      makeTab('occupancy', 'Ocupación', '/admin/hospitality/rack'),
      makeTab('summary', 'Resumen'),
      makeTab('crm_pipeline', 'Pipeline del CRM', '/admin/customers/pipeline'),
    ]);
    const fixture = await create();
    const el: HTMLElement = fixture.nativeElement;
    const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    expect(buttons.map((b) => b.textContent?.trim())).toEqual([
      'Ocupación',
      'Resumen',
      'Pipeline del CRM',
    ]);
    expect(buttons[0].getAttribute('aria-selected')).toBe('true');
    expect(loaders['occupancy']).toHaveBeenCalledTimes(1);
    expect(loaders['summary']).not.toHaveBeenCalled();
    expect(loaders['crm_pipeline']).not.toHaveBeenCalled();
    expect(el.textContent).toContain('Abrir módulo completo');
  });

  it('cambiar de pestaña carga la nueva, oculta el enlace en Resumen y no guarda nada', async () => {
    tabs.set([
      makeTab('occupancy', 'Ocupación', '/admin/hospitality/rack'),
      makeTab('summary', 'Resumen'),
    ]);
    const fixture = await create();
    const el: HTMLElement = fixture.nativeElement;
    el.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1].click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(loaders['summary']).toHaveBeenCalledTimes(1);
    expect(el.textContent).not.toContain('Abrir módulo completo');
    expect(
      el.querySelectorAll('[role="tab"]')[1].getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('si la pestaña activa desaparece vuelve a la primera', async () => {
    tabs.set([
      makeTab('occupancy', 'Ocupación', '/admin/hospitality/rack'),
      makeTab('summary', 'Resumen'),
    ]);
    const fixture = await create();
    const el: HTMLElement = fixture.nativeElement;
    el.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1].click();
    fixture.detectChanges();
    tabs.set([tabs()[0]]);
    fixture.detectChanges();
    expect(fixture.componentInstance.activeId()).toBe('occupancy');
  });
});
