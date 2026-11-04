import { Component, input, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';

import { DialogService } from '../../../../../../shared/components/dialog/dialog.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { AppPageViewComponent } from '../../../../../../public/app-page/app-page-view.component';
import type { StoreAppDetail } from '../../interfaces/store-app.interface';
import { StoreAppsService } from '../../services/store-apps.service';
import { APP_PAGE_TEMPLATES, APP_PAGE_VARIANTS, AppPageDocument, PageAppKind, clonePage } from '../../templates';
import { AppPageEditorComponent, AppPageEditorSection } from './app-page-editor.component';

@Component({ selector: 'app-app-page-view', standalone: true, template: '<p data-testid="view-stub"></p>' })
class StubPageView {
  readonly kind = input<string>();
  readonly page = input<unknown>();
  readonly preview = input<boolean>(false);
}

const detail = (over: Partial<StoreAppDetail> = {}): StoreAppDetail => ({
  key: 'product_page',
  name: 'Product page',
  description: '',
  applies_to_store_industries: true,
  status: 'draft',
  enabled: true,
  domain: { id: 1, hostname: 'roku-shop.vendix.online', status: 'active' },
  public_url: null,
  published_at: null,
  config: {},
  ...over,
});

describe('AppPageEditorComponent (apps-f2 S1/S3/S4/S6)', () => {
  let fixture: ComponentFixture<AppPageEditorComponent>;
  let component: AppPageEditorComponent;
  let apps: jasmine.SpyObj<StoreAppsService>;
  let toast: jasmine.SpyObj<ToastService>;
  let dialog: jasmine.SpyObj<DialogService>;

  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent ?? '';

  const render = (
    kind: PageAppKind,
    d: StoreAppDetail = detail(),
    section: AppPageEditorSection = 'content',
  ) => {
    fixture = TestBed.createComponent(AppPageEditorComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('kind', kind);
    fixture.componentRef.setInput('detail', d);
    fixture.componentRef.setInput('section', section);
    fixture.detectChanges();
  };
  const setSection = (section: AppPageEditorSection) => {
    fixture.componentRef.setInput('section', section);
    fixture.detectChanges();
  };
  const click = (selector: string, index = 0) => {
    (el().querySelectorAll(selector)[index] as HTMLElement).click();
    fixture.detectChanges();
  };
  const type = (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };
  const blockTypes = () => component.draft().blocks.map((b) => b.type);

  beforeEach(() => {
    apps = jasmine.createSpyObj('StoreAppsService', ['savePage']);
    toast = jasmine.createSpyObj('ToastService', ['success', 'error', 'info']);
    dialog = jasmine.createSpyObj('DialogService', ['confirm']);
    dialog.confirm.and.resolveTo(true);
    TestBed.configureTestingModule({
      imports: [AppPageEditorComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: StoreAppsService, useValue: apps },
        { provide: ToastService, useValue: toast },
        { provide: DialogService, useValue: dialog },
      ],
    });
    TestBed.overrideComponent(AppPageEditorComponent, {
      remove: { imports: [AppPageViewComponent] },
      add: { imports: [StubPageView] },
    });
  });

  it('producto: muestra sus propios bloques (Beneficios, Especificaciones), nunca los de la landing', () => {
    render('product_page');

    expect(text()).toContain('Beneficios');
    expect(text()).toContain('Especificaciones');
    expect(text()).not.toContain('Servicios del alojamiento');
    expect(blockTypes()).toEqual(APP_PAGE_TEMPLATES.product_page.page.blocks.map((b) => b.type));
  });

  it('reserva: muestra "Servicios del alojamiento" y no los bloques de producto', () => {
    render('booking', detail({ key: 'booking' }));

    expect(text()).toContain('Servicios del alojamiento');
    expect(text()).not.toContain('Beneficios');
  });

  it('sin página guardada parte de la base de la plantilla y lo avisa', () => {
    render('product_page');

    expect(component.draft()).toEqual(APP_PAGE_TEMPLATES.product_page.page);
    expect(el().querySelector('[data-testid="base-note"]')?.textContent).toContain(
      'Esta es la base sugerida para la página de producto; no se publica nada hasta que guardes.',
    );
  });

  it('con página guardada parte de ella, no de la plantilla', () => {
    const saved: AppPageDocument = {
      schema_version: 1,
      mode: 'info',
      hero: { title: 'Mi título propio' },
      blocks: [{ id: 'faq', type: 'faq', enabled: true, props: { title: 'Dudas' } }],
    };
    render('product_page', detail({ config: { page: saved } }));

    expect(component.draft()).toEqual(saved);
    expect(el().querySelector('[data-testid="base-note"]')).toBeNull();
    expect(el().querySelector('[data-testid="saved-note"]')).not.toBeNull();
    expect((el().querySelector('[data-testid="save-page"]') as HTMLButtonElement).disabled).toBeTrue();
  });

  it('apagar, mover y editar una sección actualiza el borrador', () => {
    render('product_page');
    const firstType = blockTypes()[0];
    const secondType = blockTypes()[1];

    click('[data-testid="block-toggle"]', 0);
    expect(component.draft().blocks[0].enabled).toBeFalse();

    click('[data-testid="block-down"]', 0);
    expect(blockTypes()[0]).toBe(secondType);
    expect(blockTypes()[1]).toBe(firstType);

    const titleInput = el().querySelector('[data-block] input[type="text"]') as HTMLInputElement;
    type(titleInput, 'Un título nuevo');
    expect(component.draft().blocks[0].props['title']).toBe('Un título nuevo');
    expect(el().querySelector('[data-testid="dirty-note"]') ?? el().querySelector('[data-testid="base-note"]')).not.toBeNull();
  });

  it('agrega y quita tarjetas de una lista respetando su máximo', () => {
    render('product_page');
    const benefits = () => component.draft().blocks.findIndex((b) => b.type === 'benefits');
    const before = component.listOf(benefits(), 'items').length;

    click('[data-block="benefits"] [data-testid="item-add"]');
    expect(component.listOf(benefits(), 'items').length).toBe(before + 1);

    click('[data-block="benefits"] [data-testid="item-remove"]', 0);
    expect(component.listOf(benefits(), 'items').length).toBe(before);
  });

  it('una sección que la plantilla define y la página no tiene se puede agregar; las que ya están no se ofrecen', () => {
    const saved: AppPageDocument = {
      schema_version: 1,
      blocks: [{ id: 'faq', type: 'faq', enabled: true, props: {} }],
    };
    render('product_page', detail({ config: { page: saved } }));
    expect(component.missingBlocks().some((d) => d.type === 'faq')).toBeFalse();

    component.addBlock('benefits');
    expect(blockTypes()).toEqual(['faq', 'benefits']);
    expect(component.draft().blocks[1].id).toBe('benefits');
  });

  it('las secciones "existing" muestran su descripción', () => {
    render('service_page', detail({ key: 'service_page' }));
    const existing = APP_PAGE_TEMPLATES.service_page.blocks.find((b) => b.existing);

    if (existing && blockTypes().includes(existing.type)) {
      expect(el().querySelector(`[data-block="${existing.type}"] [data-testid="existing-note"]`)).not.toBeNull();
    }
  });

  it('Restaurar base pide confirmación y vuelve a la plantilla', async () => {
    render('product_page');
    component.setMode('info');
    expect(component.draft().mode).toBe('info');

    await component.resetToBase();

    expect(dialog.confirm).toHaveBeenCalled();
    expect(component.draft()).toEqual(APP_PAGE_TEMPLATES.product_page.page);
  });

  it('Restaurar base cancelado no toca el borrador', async () => {
    render('product_page');
    component.setMode('info');
    dialog.confirm.and.resolveTo(false);

    await component.resetToBase();

    expect(component.draft().mode).toBe('info');
  });

  it('Guardar llama a savePage con el borrador y toma como nueva base la página limpia que devuelve el servidor', () => {
    render('product_page');
    component.setMode('info');
    const cleaned = clonePage(component.draft());
    cleaned.hero = { title: 'Limpio' };
    apps.savePage.and.returnValue(of({ success: true, data: { page: cleaned } }));

    click('[data-testid="save-page"]');

    expect(apps.savePage).toHaveBeenCalledOnceWith('product_page', jasmine.objectContaining({ mode: 'info' }));
    expect(toast.success).toHaveBeenCalled();
    expect(component.draft()).toEqual(cleaned);
    expect(component.baseline()).toEqual(cleaned);
    expect(component.changed()).toBeFalse();
    expect(component.canSave()).toBeFalse();
  });

  it('un error 400 muestra los textos de details.validationErrors, no "Validation failed"', () => {
    render('product_page');
    apps.savePage.and.returnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 400,
            error: {
              error_code: 'SYS_VALIDATION_001',
              message: 'Validation failed',
              details: { validationErrors: ['blocks[0].type "products_grid" no es una sección de esta app.'] },
            },
          }),
      ),
    );

    click('[data-testid="save-page"]');

    expect(toast.error).toHaveBeenCalledOnceWith('blocks[0].type "products_grid" no es una sección de esta app.');
    expect(component.saving()).toBeFalse();
  });

  it('Operación: cambiar el modo muestra u oculta los campos de venta y de reserva', () => {
    render('product_page', detail(), 'operation');
    expect(el().querySelector('[data-testid="sales-fields"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="product-mode"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="booking-fields"]')).toBeNull();
    expect(el().querySelector('[data-testid="checkout-fixed"]')?.textContent).toContain('Checkout de la tienda en línea');

    click('[data-testid="mode-booking"]');
    expect(el().querySelector('[data-testid="sales-fields"]')).toBeNull();
    expect(el().querySelector('[data-testid="booking-fields"]')).not.toBeNull();
    expect(text()).toContain('La reserva no exige crear cuenta.');

    click('[data-testid="mode-info"]');
    expect(el().querySelector('[data-testid="sales-fields"]')).toBeNull();
    expect(el().querySelector('[data-testid="booking-fields"]')).toBeNull();
  });

  it('el modo de producto único solo existe en la página de producto, y nunca se envía require_account', () => {
    render('service_page', detail({ key: 'service_page' }), 'operation');
    click('[data-testid="mode-both"]');

    expect(el().querySelector('[data-testid="sales-fields"]')).not.toBeNull();
    expect(el().querySelector('[data-testid="product-mode"]')).toBeNull();
    component.setBookingSource('rooms');
    expect(JSON.stringify(component.draft())).not.toContain('"require_account":true');
    expect(component.bookingSource()).toBe('rooms');
  });

  it('la fuente de reserva por defecto es agenda en servicios y habitaciones en reservas', () => {
    render('service_page', detail({ key: 'service_page' }));
    expect(component.bookingSource()).toBe('agenda');
    render('booking', detail({ key: 'booking' }));
    expect(component.bookingSource()).toBe('rooms');
  });

  it('Marca y SEO: colores solo con #RRGGBB válido, hostname de solo lectura y SEO en el borrador', () => {
    render('product_page', detail(), 'brand');

    expect(el().querySelector('[data-testid="seo-hostname"]')?.textContent).toContain('roku-shop.vendix.online');

    const hex = el().querySelector('[data-testid="hex-primary_color"]') as HTMLInputElement;
    type(hex, '#12');
    expect(component.draft().brand?.primary_color).toBeUndefined();
    type(hex, '#1A2B3C');
    expect(component.draft().brand?.primary_color).toBe('#1A2B3C');
    type(hex, '');
    expect(component.draft().brand).toBeUndefined();

    const seoTitle = Array.from(el().querySelectorAll('input[type="text"]')).find(
      (i) => (i.closest('label')?.textContent ?? '').includes('Título SEO'),
    ) as HTMLInputElement;
    type(seoTitle, 'Compra mi producto');
    expect(component.draft().seo?.title).toBe('Compra mi producto');
  });

  it('Vista previa: pinta la página del borrador y enlaza la publicada solo si lo está', () => {
    render('product_page', detail({ status: 'published', public_url: 'https://roku.vendix.online' }), 'preview');

    expect(el().querySelector('[data-testid="view-stub"]')).not.toBeNull();
    const link = el().querySelector('[data-testid="open-published"]') as HTMLAnchorElement;
    expect(link.textContent).toContain('Abrir la página publicada');
    expect(link.href).toContain('roku.vendix.online');

    render('product_page', detail({ status: 'draft', public_url: null }), 'preview');
    expect(el().querySelector('[data-testid="open-published"]')).toBeNull();
  });

  it('el borrador sobrevive al cambio de pestaña', () => {
    render('product_page');
    component.setMode('info');

    setSection('brand');
    setSection('content');

    expect(component.draft().mode).toBe('info');
  });

  describe('apps-f3 · plantillas y estilo', () => {
    const select = (testid: string, value: string) => {
      const box = el().querySelector<HTMLSelectElement>(`[data-testid="${testid}"]`)!;
      box.value = value;
      box.dispatchEvent(new Event('change'));
      fixture.detectChanges();
    };

    it('Contenido muestra la galería con la base y las dos variantes de la app, con sus secciones', () => {
      render('service_page');
      const cards = Array.from(el().querySelectorAll('[data-testid="template-gallery"] [data-template]'));
      expect(cards.map((c) => c.getAttribute('data-template'))).toEqual(['base', 'beauty', 'professional']);
      expect(cards[1].textContent).toContain('Belleza cálida');
      expect(cards[2].textContent).toContain('Profesional sobrio');
      // Sample of the template: its visible sections in its own order.
      expect(cards[2].querySelector('[data-testid="template-sample"]')?.textContent).toContain('1. Servicios');
      expect(el().querySelector('[data-testid="reset-base"]')).not.toBeNull();
    });

    it('Usar plantilla pide confirmación explícita y reemplaza portada, secciones y estilo, sin tocar modo, marca ni SEO', async () => {
      render('product_page');
      component.setMode('info');
      component.draft.update((p) => ({ ...p, brand: { logo_url: 'https://cdn.x.co/l.png' }, seo: { title: 'Mía' } }));
      const boutique = APP_PAGE_VARIANTS.product_page[1];

      click('[data-testid="use-template-boutique"]');
      await fixture.whenStable();

      const [args] = dialog.confirm.calls.mostRecent().args;
      expect(args.message).toContain('Reemplaza la portada, las secciones y el estilo');
      expect(args.message).toContain('No publica');
      expect(component.draft().blocks).toEqual(boutique.page.blocks);
      expect(component.draft().theme).toEqual(boutique.page.theme);
      expect(component.draft().hero).toEqual(boutique.page.hero);
      expect(component.draft().mode).toBe('info');
      expect(component.draft().brand).toEqual({ logo_url: 'https://cdn.x.co/l.png' });
      expect(component.draft().seo).toEqual({ title: 'Mía' });
      expect(apps.savePage).not.toHaveBeenCalled();
    });

    it('Usar plantilla cancelado no toca el borrador', async () => {
      render('product_page');
      const before = clonePage(component.draft());
      dialog.confirm.and.resolveTo(false);

      await component.useVariant(APP_PAGE_VARIANTS.product_page[2]);

      expect(component.draft()).toEqual(before);
    });

    it('Estilo edita el tema con controles y la vista previa en vivo recibe el borrador', () => {
      render('booking', detail({ key: 'booking' }), 'style');
      expect(el().querySelector('[data-section="style"]')).not.toBeNull();
      expect(el().querySelector('[data-testid="theme-none"]')).not.toBeNull();
      expect(el().querySelector('[data-testid="style-preview"] [data-testid="view-stub"]')).not.toBeNull();

      select('theme-density', 'compact');
      select('theme-button_style', 'outline');
      select('theme-heading_font', 'lora');
      type(el().querySelector<HTMLInputElement>('[data-testid="theme-surface_color"]')!, '#FAF5EE');
      type(el().querySelector<HTMLInputElement>('[data-testid="theme-text_color"]')!, 'rojo');

      expect(component.draft().theme).toEqual({
        density: 'compact',
        button_style: 'outline',
        heading_font: 'lora',
        surface_color: '#FAF5EE',
      });
      const preview = fixture.debugElement.query((d) => d.componentInstance instanceof StubPageView);
      expect((preview.componentInstance as StubPageView).page()).toBe(component.draft());

      select('theme-density', '');
      expect(component.draft().theme?.density).toBeUndefined();
    });

    it('un estilo rápido cambia solo el tema y Quitar estilo deja la página como hoy', () => {
      render('store_home', detail({ key: 'store_home' }), 'style');
      const blocks = clonePage(component.draft()).blocks;

      click('[data-testid="theme-preset-editorial"]');
      expect(component.draft().theme).toEqual(APP_PAGE_VARIANTS.store_home[1].page.theme!);
      expect(component.draft().blocks).toEqual(blocks);
      expect(el().querySelectorAll('[data-testid="theme-contrast"] [data-ok="true"]').length).toBeGreaterThan(0);
      expect(el().querySelector('[data-testid="theme-contrast-warning"]')).toBeNull();

      click('[data-testid="theme-clear"]');
      expect(component.draft().theme).toBeUndefined();
      expect(component.draft()).toEqual(APP_PAGE_TEMPLATES.store_home.page);
    });

    it('avisa cuando los colores elegidos se leen mal', () => {
      render('product_page', detail(), 'style');
      type(el().querySelector<HTMLInputElement>('[data-testid="theme-surface_color"]')!, '#FFFFFF');
      type(el().querySelector<HTMLInputElement>('[data-testid="theme-text_color"]')!, '#DDDDDD');

      expect(el().querySelector('[data-contrast="text"]')?.getAttribute('data-ok')).toBe('false');
      expect(el().querySelector('[data-testid="theme-contrast-warning"]')).not.toBeNull();
    });

    it('guardar envía el tema dentro de la página', () => {
      render('product_page', detail(), 'style');
      select('theme-radius', 'large');
      apps.savePage.and.returnValue(of({ success: true, data: { page: component.draft() } }));

      click('[data-testid="save-page"]');

      expect(apps.savePage).toHaveBeenCalledOnceWith(
        'product_page',
        jasmine.objectContaining({ theme: { radius: 'large' } }),
      );
    });
  });
});
