import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { By } from '@angular/platform-browser';
import { ItemListComponent } from './item-list.component';
import { TableAction } from './item-list.interfaces';

describe('ItemListComponent mobile action partition', () => {
  let fixture: ComponentFixture<ItemListComponent>;
  let component: ItemListComponent;
  const row = { id: 12, order_number: 'ORD-12', total: '$ 123.456' };
  let actions: TableAction[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ItemListComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();
    fixture = TestBed.createComponent(ItemListComponent);
    component = fixture.componentInstance;
    actions = Array.from({ length: 6 }, (_, i) => ({
      label: `Acción ${i + 1}`, icon: 'eye', action: jasmine.createSpy(`action${i}`),
    }));
    fixture.componentRef.setInput('data', [row]);
    fixture.componentRef.setInput('cardConfig', { titleKey: 'order_number', footerKey: 'total' });
    fixture.componentRef.setInput('actions', actions);
    fixture.componentRef.setInput('rowLabelKey', 'order_number');
  });
  afterEach(() => TestBed.resetTestingModule());

  async function render(): Promise<void> { await fixture.whenStable(); }
  function directButtons() {
    return fixture.debugElement.queryAll(By.css('.footer-action-btn'))
      .filter((button) => !button.nativeElement.classList.contains('card-menu-button'));
  }
  function click(selector: string, index = 0): void {
    fixture.debugElement.queryAll(By.css(selector))[index]
      .triggerEventHandler('click', new MouseEvent('click'));
  }

  for (const count of [2, 3, 4]) {
    it(`renders ${count} configured direct actions and the same overflow boundary`, async () => {
      if (count !== 2) fixture.componentRef.setInput('directActionsCount', count);
      await render();
      expect(component.directActionsCount()).toBe(count);
      expect(component.getDirectActions(row)).toEqual(actions.slice(0, count));
      expect(component.getMenuActions(row)).toEqual(actions.slice(count));
      expect(directButtons().length).toBe(count);
      click('.card-menu-button'); await render();
      expect(fixture.debugElement.queryAll(By.css('.menu-item')).length).toBe(6 - count);
    });
    it(`filters hidden actions before the ${count} direct/overflow split`, async () => {
      fixture.componentRef.setInput('directActionsCount', count);
      actions[0].show = () => false;
      await render();
      const visible = actions.slice(1);
      expect(component.getVisibleActions(row)).toEqual(visible);
      expect(component.getDirectActions(row)).toEqual(visible.slice(0, count));
      expect(component.getMenuActions(row)).toEqual(visible.slice(count));
      expect(directButtons().length).toBe(count);
    });
  }

  it('renders all actions in dropdown mode regardless of direct count', async () => {
    fixture.componentRef.setInput('actionsDisplay', 'dropdown');
    fixture.componentRef.setInput('directActionsCount', 4);
    await render();
    expect(component.getDirectActions(row)).toEqual([]);
    expect(component.getMenuActions(row)).toEqual(actions);
    expect(directButtons().length).toBe(0);
    click('.card-menu-button'); await render();
    expect(fixture.debugElement.queryAll(By.css('.menu-item')).length).toBe(6);
  });
  it('does not render an overflow trigger when every action fits', async () => {
    fixture.componentRef.setInput('actions', actions.slice(0, 3));
    fixture.componentRef.setInput('directActionsCount', 3);
    await render();
    expect(fixture.debugElement.query(By.css('.card-menu-button'))).toBeNull();
  });
  it('handles missing actions without buttons or menus', async () => {
    fixture.componentRef.setInput('actions', undefined); await render();
    expect(component.getDirectActions(row)).toEqual([]);
    expect(component.getMenuActions(row)).toEqual([]);
    expect(directButtons().length).toBe(0);
  });
  it('hides every action denied by show', async () => {
    actions.forEach((action) => action.show = () => false); await render();
    expect(directButtons().length).toBe(0);
    expect(component.getMenuActions(row)).toEqual([]);
    expect(fixture.debugElement.query(By.css('.card-menu-button'))).toBeNull();
  });
  it('reacts to public direct-count input changes without manual detection', async () => {
    await render(); expect(directButtons().length).toBe(2);
    fixture.componentRef.setInput('directActionsCount', 4); await render();
    expect(directButtons().length).toBe(4);
    expect(component.getMenuActions(row)).toEqual(actions.slice(4));
  });
  it('reacts to new action input and updated show policy', async () => {
    await render();
    fixture.componentRef.setInput('actions', [{ ...actions[0], show: () => false }, actions[5]]);
    await render();
    expect(directButtons().length).toBe(1);
    expect(component.getDirectActions(row)[0]).toBe(actions[5]);
  });
  it('executes a direct action exactly once with its original object and row', async () => {
    const emitted = jasmine.createSpy('actionClick'); component.actionClick.subscribe(emitted);
    const selected = jasmine.createSpy('itemClick'); component.itemClick.subscribe(selected);
    await render(); click('.footer-action-btn'); await render();
    expect(actions[0].action).toHaveBeenCalledOnceWith(row);
    expect(emitted).toHaveBeenCalledOnceWith({ action: actions[0], item: row });
    expect(selected).not.toHaveBeenCalled();
  });
  it('executes overflow once and closes the menu', async () => {
    await render(); click('.card-menu-button'); await render();
    click('.menu-item'); await render();
    expect(actions[2].action).toHaveBeenCalledOnceWith(row);
    expect(component.activeMenuIndex).toBeNull();
    expect(fixture.debugElement.queryAll(By.css('.menu-item')).length).toBe(0);
  });
  it('disabled direct action stays disabled and cannot emit or execute', async () => {
    actions[0].disabled = () => true;
    const emitted = jasmine.createSpy('emitted'); component.actionClick.subscribe(emitted);
    await render();
    expect(directButtons()[0].nativeElement.disabled).toBeTrue();
    click('.footer-action-btn');
    expect(actions[0].action).not.toHaveBeenCalled(); expect(emitted).not.toHaveBeenCalled();
  });
  it('disabled overflow action cannot execute and still closes the menu', async () => {
    actions[2].disabled = () => true;
    await render(); click('.card-menu-button'); await render();
    expect(fixture.debugElement.query(By.css('.menu-item')).nativeElement.disabled).toBeTrue();
    click('.menu-item'); await render();
    expect(actions[2].action).not.toHaveBeenCalled(); expect(component.activeMenuIndex).toBeNull();
  });
  it('direct buttons expose dynamic label, tooltip, icon and variant without identity changes', async () => {
    actions[0].label = (item) => `Ver ${item.id}`;
    actions[0].tooltip = (item) => `Detalle ${item.order_number}`;
    actions[0].icon = () => 'printer'; actions[0].variant = () => 'danger';
    await render(); const button = directButtons()[0].nativeElement;
    expect(button.getAttribute('aria-label')).toBe('Ver 12: ORD-12');
    expect(button.title).toBe('Detalle ORD-12');
    expect(button.classList.contains('action-danger')).toBeTrue();
    expect(component.getDirectActions(row)[0]).toBe(actions[0]);
  });
  it('names the menu trigger with the row identifier', async () => {
    await render();
    expect(fixture.debugElement.query(By.css('.card-menu-button')).nativeElement.getAttribute('aria-label'))
      .toBe('Más acciones: ORD-12');
  });
  it('menu actions retain accessible row names and tooltip fallback', async () => {
    await render(); click('.card-menu-button'); await render();
    const button = fixture.debugElement.query(By.css('.menu-item')).nativeElement;
    expect(button.getAttribute('aria-label')).toBe('Acción 3: ORD-12');
    expect(component.getActionTooltip(actions[2], row)).toBe('Acción 3');
  });
  it('keeps direct and overflow disjoint under reordered translated labels', async () => {
    actions.reverse(); actions.forEach((action) => action.label = () => 'Mismo texto');
    fixture.componentRef.setInput('directActionsCount', 4); await render();
    const direct = component.getDirectActions(row), menu = component.getMenuActions(row);
    expect([...direct, ...menu]).toEqual(actions);
    expect(menu.some((action) => direct.includes(action))).toBeFalse();
  });
});
