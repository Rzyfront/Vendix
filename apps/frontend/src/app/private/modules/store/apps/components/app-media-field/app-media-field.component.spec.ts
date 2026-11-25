import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { ToastService } from '../../../../../../shared/components';
import { AppMediaItem, AppMediaPage, AppMediaService } from '../../services/app-media.service';
import { AppMediaFieldComponent } from './app-media-field.component';

describe('AppMediaFieldComponent', () => {
  let fixture: ComponentFixture<AppMediaFieldComponent>;
  let emitted: string[];
  let mediaSpy: jasmine.SpyObj<AppMediaService>;

  const sampleItem: AppMediaItem = {
    id: 42,
    app_kind: 'product_page',
    kind: 'image',
    mime_type: 'image/webp',
    size_bytes: 24576,
    width: 1200,
    height: 800,
    alt: 'Foto del producto',
    created_at: '2026-11-25T10:00:00.000Z',
    url: 'https://api.vendix.online/api/public/apps/media/42',
    thumb_url: 'https://api.vendix.online/api/public/apps/media/42?thumb=1',
  };

  const samplePage: AppMediaPage = { data: [sampleItem], total: 1, page: 1, limit: 24 };

  beforeEach(() => {
    mediaSpy = jasmine.createSpyObj<AppMediaService>('AppMediaService', ['list', 'upload', 'updateAlt', 'remove']);
    mediaSpy.list.and.returnValue(of(samplePage));

    const toastStub = jasmine.createSpyObj<ToastService>('ToastService', ['success', 'error', 'info', 'warning']);

    TestBed.configureTestingModule({
      imports: [AppMediaFieldComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: AppMediaService, useValue: mediaSpy },
        { provide: ToastService, useValue: toastStub },
      ],
    });

    emitted = [];
    fixture = TestBed.createComponent(AppMediaFieldComponent);
    fixture.componentRef.setInput('appKind', 'product_page');
    fixture.componentInstance.valueChange.subscribe((url) => emitted.push(url));
    fixture.detectChanges();
  });

  const el = () => fixture.nativeElement as HTMLElement;

  it('abre la galería y emite la URL estable elegida al hacer clic en una foto, devolviendo el foco al botón', async () => {
    const galleryBtn = el().querySelector('[data-testid="media-field-gallery"]') as HTMLButtonElement;
    expect(galleryBtn.getAttribute('aria-haspopup')).toBe('dialog');
    galleryBtn.click();
    fixture.detectChanges();
    await fixture.whenStable();

    // Debounce de búsqueda de AppMediaPickerComponent (250 ms)
    await new Promise((resolve) => setTimeout(resolve, 320));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mediaSpy.list).toHaveBeenCalled();
    const thumbBtn = el().querySelector('.amp-thumb') as HTMLButtonElement;
    expect(thumbBtn).not.toBeNull();

    thumbBtn.focus();
    thumbBtn.click();
    fixture.detectChanges();

    expect(emitted).toEqual(['https://api.vendix.online/api/public/apps/media/42']);
    expect(fixture.componentInstance.pickerOpen()).toBeFalse();
    expect(document.activeElement).toBe(galleryBtn);
  });

  it('devuelve el foco al botón Galería al cerrar el modal sin elegir foto', () => {
    const galleryBtn = el().querySelector('[data-testid="media-field-gallery"]') as HTMLButtonElement;
    galleryBtn.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.pickerOpen()).toBeTrue();

    const input = el().querySelector('[data-testid="media-field-input"]') as HTMLInputElement;
    input.focus();
    fixture.componentInstance.closePicker();
    fixture.detectChanges();

    expect(fixture.componentInstance.pickerOpen()).toBeFalse();
    expect(document.activeElement).toBe(galleryBtn);
  });

  it('muestra miniatura decorativa (alt="") cuando recibe una URL https y permite limpiarla', () => {
    fixture.componentRef.setInput('value', sampleItem.url);
    fixture.detectChanges();

    const img = el().querySelector('[data-testid="media-field-preview"] img') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.src).toBe(sampleItem.url!);
    expect(img.getAttribute('alt')).toBe('');

    const input = el().querySelector('[data-testid="media-field-input"]') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.getAttribute('aria-describedby')).toBeNull();

    (el().querySelector('[data-testid="media-field-clear"]') as HTMLButtonElement).click();
    expect(emitted).toEqual(['']);
  });

  it('marca error con aria-invalid y aria-describedby si la URL no empieza por https://', () => {
    fixture.componentRef.setInput('value', 'http://inseguro.co/foto.jpg');
    fixture.detectChanges();

    const errorEl = el().querySelector('[data-testid="media-field-error"]') as HTMLElement;
    const input = el().querySelector('[data-testid="media-field-input"]') as HTMLInputElement;
    expect(errorEl?.textContent).toContain('https://');
    expect(errorEl?.id).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(errorEl.id);
    expect(el().querySelector('[data-testid="media-field-preview"] img')).toBeNull();
  });
});
