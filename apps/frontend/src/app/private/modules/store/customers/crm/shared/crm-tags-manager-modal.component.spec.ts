import {
  CUSTOM_ELEMENTS_SCHEMA,
  Signal,
  WritableSignal,
  provideZonelessChangeDetection,
} from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ToastService } from '../../../../../../shared/components';
import { CrmService } from './crm.service';
import { CrmTag } from './crm.interface';
import { CrmTagsManagerModalComponent } from './crm-tags-manager-modal.component';

const tag = (id: number, name: string, customers_count = 0, color: string | null = null): CrmTag => ({
  id,
  name,
  color,
  customers_count,
});

const duplicate = () =>
  new HttpErrorResponse({
    status: 409,
    error: {
      success: false,
      error_code: 'CRM_TAG_002',
      message: 'Ya existe una etiqueta con ese nombre.',
    },
  });

/** What the specs drive and read; the shared components are not under test. */
interface ManagerInternals {
  tags: Signal<CrmTag[]>;
  editingId: Signal<number | null>;
  draftName: WritableSignal<string>;
  draftColor: WritableSignal<string | null>;
  newName: WritableSignal<string>;
  toDelete: Signal<CrmTag | null>;
  deleteMessage: Signal<string>;
  startEdit(tag: CrmTag): void;
  saveEdit(): Promise<void>;
  create(): Promise<void>;
  askDelete(tag: CrmTag): void;
  confirmDelete(): Promise<void>;
}

describe('CrmTagsManagerModalComponent — manage the CRM tag catalog', () => {
  let crm: jasmine.SpyObj<CrmService>;
  let toast: jasmine.SpyObj<ToastService>;
  let fixture: ComponentFixture<CrmTagsManagerModalComponent>;
  let catalog: CrmTag[];
  let emitted: CrmTag[][];

  const manager = () => fixture.componentInstance as unknown as ManagerInternals;
  const text = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const names = () => manager().tags().map((row) => row.name);

  async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve));
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function open(): Promise<void> {
    fixture.componentRef.setInput('isOpen', true);
    fixture.detectChanges();
    await settle();
  }

  beforeEach(async () => {
    catalog = [tag(2, 'Mayorista', 1), tag(1, 'VIP', 3, '#3B82F6'), tag(3, 'Abandonó carrito')];
    emitted = [];
    crm = jasmine.createSpyObj<CrmService>('CrmService', [
      'tags',
      'createTag',
      'updateTag',
      'deleteTag',
    ]);
    crm.tags.and.callFake(() => of(catalog));
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error']);
    await TestBed.configureTestingModule({
      imports: [CrmTagsManagerModalComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: CrmService, useValue: crm },
        { provide: ToastService, useValue: toast },
      ],
    })
      .overrideComponent(CrmTagsManagerModalComponent, {
        set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(CrmTagsManagerModalComponent);
    fixture.componentInstance.changed.subscribe((rows) => emitted.push(rows));
    fixture.detectChanges();
  });

  it('loads nothing until it is opened', () => {
    expect(crm.tags).not.toHaveBeenCalled();
  });

  it('lists every tag by name with how many customers carry it', async () => {
    await open();

    expect(crm.tags).toHaveBeenCalledTimes(1);
    expect(names()).toEqual(['Abandonó carrito', 'Mayorista', 'VIP']);
    expect(text()).toContain('VIP');
    expect(text()).toContain('3 clientes');
    expect(text()).toContain('1 cliente');
    expect(text()).toContain('0 clientes');
    expect(text()).not.toContain('Aún no hay etiquetas');
  });

  it('shows the empty state when the store has no tags', async () => {
    catalog = [];
    await open();

    expect(text()).toContain('Aún no hay etiquetas. Crea la primera arriba.');
  });

  it('renames a tag: sends only the new name and emits the updated catalog', async () => {
    await open();
    crm.updateTag.and.returnValue(of(tag(1, 'Clientes VIP', 0, '#3B82F6')));

    manager().startEdit(catalog[1]);
    manager().draftName.set('  Clientes VIP  ');
    await manager().saveEdit();
    await settle();

    expect(crm.updateTag).toHaveBeenCalledOnceWith(1, { name: 'Clientes VIP' });
    expect(manager().editingId()).toBeNull();
    expect(names()).toEqual(['Abandonó carrito', 'Clientes VIP', 'Mayorista']);
    // The customers it already had are kept (PATCH does not count them).
    expect(manager().tags().find((row) => row.id === 1)?.customers_count).toBe(3);
    expect(text()).toContain('Clientes VIP');
    expect(emitted.length).toBe(1);
    expect(emitted[0].map((row) => row.name)).toEqual(['Abandonó carrito', 'Clientes VIP', 'Mayorista']);
    expect(toast.success).toHaveBeenCalledWith('Etiqueta actualizada');
  });

  it('changing only the color sends only the color; clearing it sends null', async () => {
    await open();
    crm.updateTag.and.callFake((id: number, body) =>
      of(tag(id, 'VIP', 0, body.color ?? null)),
    );

    manager().startEdit(catalog[1]);
    manager().draftColor.set('#16A34A');
    await manager().saveEdit();
    expect(crm.updateTag).toHaveBeenCalledWith(1, { color: '#16A34A' });
    expect(manager().tags().find((row) => row.id === 1)?.color).toBe('#16A34A');

    manager().startEdit(manager().tags().find((row) => row.id === 1)!);
    manager().draftColor.set(null);
    await manager().saveEdit();
    expect(crm.updateTag).toHaveBeenCalledWith(1, { color: null });
  });

  it('saving without changes closes the editor without calling the API', async () => {
    await open();

    manager().startEdit(catalog[1]);
    manager().draftColor.set('#3b82f6'); // same color, other case
    await manager().saveEdit();

    expect(crm.updateTag).not.toHaveBeenCalled();
    expect(manager().editingId()).toBeNull();
    expect(emitted.length).toBe(0);
  });

  it('a duplicate name shows a clear message and keeps the editor open', async () => {
    await open();
    crm.updateTag.and.returnValue(throwError(() => duplicate()));

    manager().startEdit(catalog[1]);
    manager().draftName.set('Mayorista');
    await manager().saveEdit();

    expect(toast.error).toHaveBeenCalledOnceWith(
      'Ya existe una etiqueta con ese nombre. Usa otro nombre.',
    );
    expect(manager().editingId()).toBe(1);
    expect(names()).toEqual(['Abandonó carrito', 'Mayorista', 'VIP']);
    expect(emitted.length).toBe(0);
  });

  it('creating a duplicate name shows the same message and keeps the typed name', async () => {
    await open();
    crm.createTag.and.returnValue(throwError(() => duplicate()));

    manager().newName.set('VIP');
    await manager().create();

    expect(toast.error).toHaveBeenCalledOnceWith(
      'Ya existe una etiqueta con ese nombre. Usa otro nombre.',
    );
    expect(manager().newName()).toBe('VIP');
    expect(emitted.length).toBe(0);
  });

  it('creates a tag with no customers, in name order', async () => {
    await open();
    crm.createTag.and.returnValue(of(tag(9, 'Frecuente', 0)));

    manager().newName.set(' Frecuente ');
    await manager().create();

    expect(crm.createTag).toHaveBeenCalledOnceWith({ name: 'Frecuente' });
    expect(names()).toEqual(['Abandonó carrito', 'Frecuente', 'Mayorista', 'VIP']);
    expect(manager().newName()).toBe('');
    expect(emitted[0].find((row) => row.id === 9)?.customers_count).toBe(0);
  });

  it('deletes only after confirming, warning that customers are not deleted', async () => {
    await open();
    crm.deleteTag.and.returnValue(of({ id: 1 }));

    manager().askDelete(catalog[1]);
    await settle();

    expect(crm.deleteTag).not.toHaveBeenCalled();
    expect(manager().toDelete()?.id).toBe(1);
    expect(manager().deleteMessage()).toBe(
      '¿Eliminar la etiqueta «VIP»? Se quitará de 3 clientes. Los clientes no se borran.',
    );

    await manager().confirmDelete();
    await settle();

    expect(crm.deleteTag).toHaveBeenCalledOnceWith(1);
    expect(manager().toDelete()).toBeNull();
    expect(names()).toEqual(['Abandonó carrito', 'Mayorista']);
    expect(emitted.length).toBe(1);
    expect(emitted[0].map((row) => row.id)).toEqual([3, 2]);
    expect(toast.success).toHaveBeenCalledWith('Etiqueta eliminada');
  });

  it('the confirmation of a tag nobody has says so, and escapes the name', async () => {
    await open();

    manager().askDelete(tag(5, '<b>Nueva</b>', 0));

    expect(manager().deleteMessage()).toBe(
      '¿Eliminar la etiqueta «&lt;b&gt;Nueva&lt;/b&gt;»? No está asignada a ningún cliente.',
    );
  });

  it('a failed delete keeps the tag and tells why', async () => {
    await open();
    crm.deleteTag.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 404,
            error: { success: false, error_code: 'CRM_TAG_001', message: 'La etiqueta no existe.' },
          }),
      ),
    );

    manager().askDelete(catalog[0]);
    await manager().confirmDelete();

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(names()).toEqual(['Abandonó carrito', 'Mayorista', 'VIP']);
    expect(emitted.length).toBe(0);
  });
});
