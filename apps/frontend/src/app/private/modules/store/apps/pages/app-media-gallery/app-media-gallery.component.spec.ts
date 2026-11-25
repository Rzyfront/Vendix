import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { AppMediaGalleryComponent } from './app-media-gallery.component';
import { AppMediaItem, AppMediaService } from '../../services/app-media.service';
import { ToastService } from '../../../../../../shared/components';

function item(over: Partial<AppMediaItem> = {}): AppMediaItem {
  return {
    id: 1,
    app_kind: null,
    kind: 'image',
    mime_type: 'image/webp',
    size_bytes: 120_000,
    width: null,
    height: null,
    alt: 'Fachada',
    created_at: '2026-11-25T10:00:00.000Z',
    url: 'https://api.test/public/apps/media/3f1e1a9e-7f0c-4a1d-9f7e-1b2c3d4e5f60',
    thumb_url: 'https://api.test/public/apps/media/3f1e1a9e-7f0c-4a1d-9f7e-1b2c3d4e5f60?thumb=1',
    ...over,
  };
}

describe('AppMediaGalleryComponent', () => {
  let list: jasmine.Spy;
  let remove: jasmine.Spy;
  let toast: jasmine.SpyObj<ToastService>;

  function setup() {
    list = jasmine.createSpy('list').and.returnValue(of({ data: [item()], total: 1, page: 1, limit: 24 }));
    remove = jasmine.createSpy('remove').and.returnValue(of({ deleted: true }));
    toast = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'info']);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AppMediaService,
          useValue: {
            list,
            remove,
            upload: () => of([]),
            updateAlt: () => of(item()),
          },
        },
        { provide: ToastService, useValue: toast },
      ],
    });
    return TestBed.createComponent(AppMediaGalleryComponent).componentInstance;
  }

  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

  afterEach(() => {
    // No dejar el portapapeles parcheado: otras specs lo espían con spyOnProperty.
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard);
    } else {
      delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });

  it('copia el enlace estable del medio, no una firma', async () => {
    const writeText = jasmine.createSpy('writeText').and.returnValue(Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const component = setup();
    await component.copyLink(item());
    expect(writeText).toHaveBeenCalledWith(
      'https://api.test/public/apps/media/3f1e1a9e-7f0c-4a1d-9f7e-1b2c3d4e5f60',
    );
    expect(toast.success).toHaveBeenCalled();
  });

  it('quitar abre la confirmación y no borra hasta confirmar', () => {
    const component = setup();
    component.remove(item());
    expect(remove).not.toHaveBeenCalled();
    expect(component.deleteOpen()).toBe(true);
    component.confirmRemove();
    expect(remove).toHaveBeenCalledWith(1);
  });

  it('cancelar la confirmación no borra nada', () => {
    const component = setup();
    component.remove(item());
    // Cancelar cierra el modal y descarta el pendiente (lo que hace el output
    // `cancel` del modal); después, confirmar no borra nada.
    component.deleteOpen.set(false);
    component.pendingDelete.set(null);
    component.confirmRemove();
    expect(remove).not.toHaveBeenCalled();
  });

  it('la cadena de búsqueda sobrevive a un error', async () => {
    list.and.returnValue(throwError(() => new Error('boom')));
    const component = setup();
    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    // La app corre sin zone.js: se espera el debounce con timers reales.
    await wait(320);
    component.onSearch('primera');
    await wait(320);
    expect(component.loading()).toBe(false);
    const callsAfterError = list.calls.count();
    // Si el catchError hubiera cerrado la cadena, esta segunda búsqueda no
    // llegaría al servicio.
    component.onSearch('segunda');
    await wait(320);
    expect(list.calls.count()).toBe(callsAfterError + 1);
    expect(component.loading()).toBe(false);
  });
});
