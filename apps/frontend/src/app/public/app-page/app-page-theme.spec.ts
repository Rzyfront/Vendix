import type { AppPageDocument, AppPageTheme } from '../../private/modules/store/apps/templates/app-page.types';
import { APP_THEME_PALETTES } from '../../private/modules/store/apps/templates/app-page.types';
import {
  MIN_BORDER_CONTRAST,
  borderContrast,
  contrastChecks,
  themeMarkers,
  themeStyle,
} from './app-page-theme';

const doc = (theme?: AppPageTheme): AppPageDocument => ({ schema_version: 1, blocks: [], ...(theme ? { theme } : {}) });

/** CSS variables added by Apps F7. */
const F7_VARS = [
  '--ap-border',
  '--ap-font-scale',
  '--ap-heading-scale',
  '--ap-section-gap',
  '--ap-card-shadow',
  '--ap-image-ratio',
  '--ap-image-overlay',
  '--ap-image-brightness',
  '--ap-hero-py',
  '--ap-hero-py-md',
];

describe('app-page-theme (apps-f7 extended tokens)', () => {
  it('a page without theme binds nothing and no marker', () => {
    expect(themeStyle(doc())).toBeNull();
    expect(themeMarkers(doc())).toEqual({ type: null, card: null, shadow: null, overlay: null, hero: null });
  });

  it('an F3-only theme binds none of the F7 variables or markers (renders as today)', () => {
    const vars = themeStyle(doc({ primary_color: '#7A3E2E', density: 'spacious', radius: 'large' }))!;
    for (const name of F7_VARS) expect(vars[name]).withContext(name).toBeUndefined();
    expect(themeMarkers(doc({ density: 'spacious' }))).toEqual({
      type: null,
      card: null,
      shadow: null,
      overlay: null,
      hero: null,
    });
  });

  it('maps every extended token to its CSS variable', () => {
    const vars = themeStyle(
      doc({
        border_color: '#D6CFC4',
        base_font_size: 'lg',
        heading_scale: 'display',
        section_gap: 'tight',
        shadow: 'soft',
        image_ratio: '16:9',
        image_overlay: 40,
        hero_height: 'compact',
      }),
    )!;
    expect(vars['--ap-border']).toBe('#D6CFC4');
    expect(vars['--color-border']).toBe('#D6CFC4');
    expect(vars['--ap-font-scale']).toBe('1.0625');
    expect(vars['--ap-heading-scale']).toBe('1.25');
    expect(vars['--ap-section-gap']).toBe('0.6');
    expect(vars['--ap-card-shadow']).toContain('rgba');
    expect(vars['--ap-image-ratio']).toBe('16 / 9');
    expect(vars['--ap-image-overlay']).toBe('0.4');
    expect(vars['--ap-image-brightness']).toBe('0.6');
    expect(vars['--ap-hero-py']).toBe('2rem');
    expect(vars['--ap-hero-py-md']).toBe('2.5rem');
  });

  it('the "normal" choices keep today\'s values (scale 1, hero py-12 / md:py-16)', () => {
    const vars = themeStyle(
      doc({ base_font_size: 'md', heading_scale: 'normal', section_gap: 'normal', image_ratio: 'square', hero_height: 'auto', shadow: 'none' }),
    )!;
    expect(vars['--ap-font-scale']).toBe('1');
    expect(vars['--ap-heading-scale']).toBe('1');
    expect(vars['--ap-section-gap']).toBe('1');
    expect(vars['--ap-image-ratio']).toBe('1 / 1');
    expect(vars['--ap-hero-py']).toBe('3rem');
    expect(vars['--ap-hero-py-md']).toBe('4rem');
    expect(vars['--ap-card-shadow']).toBe('none');
  });

  it('the border color wins over the border derived from the palette', () => {
    const vars = themeStyle(doc({ surface_color: '#FBF7F2', text_color: '#2B211C', border_color: '#000000' }))!;
    expect(vars['--color-border']).toBe('#000000');
  });

  it('a veil of 0 is bound (no darkening); invalid values are ignored', () => {
    expect(themeStyle(doc({ image_overlay: 0 }))!['--ap-image-brightness']).toBe('1');
    expect(themeMarkers(doc({ image_overlay: 0 })).overlay).toBe('');
    for (const bad of [81, -5, 12.5]) {
      const page = doc({ image_overlay: bad });
      expect(themeStyle(page)!['--ap-image-overlay']).withContext(String(bad)).toBeUndefined();
      expect(themeMarkers(page).overlay).withContext(String(bad)).toBeNull();
    }
    expect(themeStyle(doc({ border_color: 'gray' }))!['--ap-border']).toBeUndefined();
  });

  it('markers turn on only the rules of the tokens that are set', () => {
    expect(themeMarkers(doc({ base_font_size: 'sm' })).type).toBe('');
    expect(themeMarkers(doc({ heading_scale: 'compact' })).type).toBe('');
    expect(themeMarkers(doc({ card_style: 'soft' })).card).toBe('soft');
    expect(themeMarkers(doc({ shadow: 'strong' })).shadow).toBe('');
    expect(themeMarkers(doc({ hero_height: 'full' })).hero).toBe('full');
  });

  it('warns when the border color is almost the background', () => {
    expect(borderContrast({})).toBeNull();
    expect(borderContrast({ border_color: '#FAFAFA' })!.ok).toBeFalse();
    expect(borderContrast({ border_color: '#F9F5F0', surface_color: '#FBF7F2' })!.ok).toBeFalse();
    const visible = borderContrast({ border_color: '#C8BFB3', surface_color: '#FBF7F2' })!;
    expect(visible.ok).toBeTrue();
    expect(visible.ratio).toBeGreaterThanOrEqual(MIN_BORDER_CONTRAST);
  });

  it('every quick palette passes the existing readability checks', () => {
    for (const palette of APP_THEME_PALETTES) {
      const failing = contrastChecks(palette.colors).filter((c) => !c.ok);
      expect(failing).withContext(palette.id).toEqual([]);
      expect(Object.keys(palette.colors).length).toBe(5);
    }
  });
});
