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

  it('abre la galería y emite la URL estable elegida al hacer clic en una foto', async () => {
    (el().querySelector('[data-testid="media-field-gallery"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    await fixture.whenStable();

    // Debounce de búsqueda de AppMediaPickerComponent (250 ms)
    await new Promise((resolve) => setTimeout(resolve, 320));
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mediaSpy.list).toHaveBeenCalled();
    const thumbBtn = el().querySelector('.amp-thumb') as HTMLButtonElement;
    expect(thumbBtn).not.toBeNull();

    thumbBtn.click();
    fixture.detectChanges();

    expect(emitted).toEqual(['https://api.vendix.online/api/public/apps/media/42']);
    expect(fixture.componentInstance.pickerOpen()).toBeFalse();
  });

  it('muestra miniatura cuando recibe una URL https y permite limpiarla', () => {
    fixture.componentRef.setInput('value', sampleItem.url);
    fixture.detectChanges();

    const img = el().querySelector('[data-testid="media-field-preview"] img') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.src).toBe(sampleItem.url!);

    (el().querySelector('[data-testid="media-field-clear"]') as HTMLButtonElement).click();
    expect(emitted).toEqual(['']);
  });

  it('marca error si se escribe una URL que no empieza por https://', () => {
    fixture.componentRef.setInput('value', 'http://inseguro.co/foto.jpg');
    fixture.detectChanges();

    expect(el().querySelector('[data-testid="media-field-error"]')?.textContent).toContain('https://');
    expect(el().querySelector('[data-testid="media-field-preview"] img')).toBeNull();
  });
});
