import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { APP_THEME_PALETTES, AppPageTheme, PageAppKind } from '../templates';
import { AppPageStylePanelComponent } from './app-page-style-panel.component';

describe('AppPageStylePanelComponent (apps-f7)', () => {
  let fixture: ComponentFixture<AppPageStylePanelComponent>;
  let emitted: AppPageTheme[];

  const render = (theme: AppPageTheme = {}, kind: PageAppKind = 'product_page') => {
    fixture = TestBed.createComponent(AppPageStylePanelComponent);
    fixture.componentRef.setInput('kind', kind);
    fixture.componentRef.setInput('theme', theme);
    fixture.componentRef.setInput('brand', {});
    emitted = [];
    fixture.componentInstance.themeChange.subscribe((t) => emitted.push(t));
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  const q = (el: HTMLElement, testId: string) => el.querySelector<HTMLElement>(`[data-testid="${testId}"]`);

  beforeEach(() =>
    TestBed.configureTestingModule({
      imports: [AppPageStylePanelComponent],
      providers: [provideZonelessChangeDetection()],
    }),
  );

  it('groups the controls in Colores, Tipografía, Espaciado y tarjetas, Imágenes y portada', () => {
    const el = render();
    const titles = ['colors', 'typography', 'spacing', 'images'].map((g) => q(el, 'style-group-' + g)?.querySelector('h3')?.textContent?.trim());
    expect(titles).toEqual(['Colores', 'Tipografía', 'Espaciado y tarjetas', 'Imágenes y portada']);
  });

  it('a quick palette emits the five colors at once and keeps the other tokens', () => {
    const el = render({ radius: 'large', primary_color: '#000000' });
    const palette = APP_THEME_PALETTES[0];
    q(el, 'style-palette-' + palette.id)!.click();
    expect(emitted.length).toBe(1);
    expect(emitted[0]).toEqual({ radius: 'large', ...palette.colors });
    expect(Object.keys(palette.colors).sort()).toEqual(
      ['accent_color', 'primary_color', 'secondary_color', 'surface_color', 'text_color'],
    );
  });

  it('a chip sets its token and «Como hoy» removes it', () => {
    const el = render({ shadow: 'soft' });
    q(el, 'style-card_style-flat')!.click();
    expect(emitted.pop()).toEqual({ shadow: 'soft', card_style: 'flat' });
    q(el, 'style-shadow-default')!.click();
    expect(emitted.pop()).toEqual({});
  });

  it('the veil slider emits an integer within 0..80 and can be removed', () => {
    const el = render({ image_overlay: 30 });
    const slider = q(el, 'style-image_overlay') as HTMLInputElement;
    expect(slider.max).toBe('80');
    slider.value = '45';
    slider.dispatchEvent(new Event('input'));
    expect(emitted.pop()).toEqual({ image_overlay: 45 });
    fixture.componentInstance.setOverlay('200');
    expect(emitted.pop()).toEqual({ image_overlay: 80 });
    q(el, 'style-image_overlay-clear')!.click();
    expect(emitted.pop()).toEqual({});
  });

  it('warns when the border color is almost the background, and not otherwise', () => {
    expect(q(render({ border_color: '#FDFDFD' }), 'style-border-warning')).not.toBeNull();
    expect(q(render({ border_color: '#9CA3AF' }), 'style-border-warning')).toBeNull();
  });

  it('keeps the existing readability check', () => {
    const el = render({ accent_color: '#FFFF00' });
    expect(q(el, 'style-contrast')).not.toBeNull();
    expect(q(el, 'style-contrast-warning')).not.toBeNull();
  });

  it('the store home keeps only the F3 tokens (no palettes, border or extended chips)', () => {
    const el = render({}, 'store_home');
    expect(q(el, 'style-palette-' + APP_THEME_PALETTES[0].id)).toBeNull();
    expect(q(el, 'style-border_color')).toBeNull();
    expect(q(el, 'style-shadow')).toBeNull();
    expect(q(el, 'style-image_overlay')).toBeNull();
    expect(q(el, 'style-radius')).not.toBeNull();
  });
});
