import { fontStack, safeColor, safeUrl } from '../../../app-page/app-page-view.util';
import type { CrmBlock, CrmLandingDocument, CrmLandingFont } from '../../blocks/landing-blocks.types';

/** Pre-F6 defaults of the landing palette (`StoreLandingComponent`). */
export const DEFAULT_LANDING_PRIMARY = '#1E40AF';
export const DEFAULT_LANDING_SECONDARY = '#0F172A';
export const DEFAULT_WHATSAPP_MESSAGE =
  '¡Hola! Vi su catálogo en la landing y quiero más información.';

/** F6-A: the sections the public page renders (the owner may hide some). */
export function visibleBlocks(document: CrmLandingDocument | null | undefined): CrmBlock[] {
  return (document?.blocks ?? []).filter((block) => block.hidden !== true);
}

/** `wa.me` link of the floating button, or `null` without a number. */
export function whatsappLink(document: CrmLandingDocument | null | undefined): string | null {
  const digits = document?.theme?.whatsapp_number?.replace(/[^0-9]/g, '') ?? '';
  if (!digits) return null;
  const message = document?.theme?.whatsapp_message?.trim() || DEFAULT_WHATSAPP_MESSAGE;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

/**
 * CSS custom properties of the landing container. Typography only produces a
 * property when the owner picked a font, so a page without one keeps the
 * inherited font exactly as before F6.
 */
export function landingStyleVars(document: CrmLandingDocument | null | undefined): Record<string, string> {
  const theme = document?.theme;
  const vars: Record<string, string> = {
    '--crm-primary': safeColor(theme?.primary_color) ?? DEFAULT_LANDING_PRIMARY,
    '--crm-secondary': safeColor(theme?.secondary_color) ?? DEFAULT_LANDING_SECONDARY,
  };
  const heading = fontStack(theme?.font_heading);
  const body = fontStack(theme?.font_body);
  if (heading) vars['--crm-font-heading'] = heading;
  if (body) vars['--crm-font-body'] = body;
  return vars;
}

/** The owner's logo (https only), else `null` so the store branding logo stays. */
export function landingLogo(document: CrmLandingDocument | null | undefined): string | null {
  return safeUrl(document?.theme?.logo_url?.trim());
}

/** Google Fonts family of each catalog font; system and inter are always available. */
const GOOGLE_FAMILY: Partial<Record<CrmLandingFont, string>> = {
  poppins: 'Poppins',
  playfair: 'Playfair Display',
  montserrat: 'Montserrat',
  lora: 'Lora',
};

/**
 * Loads the stylesheet of the fonts the landing uses, once per document.
 * Without fonts picked nothing is added (pre-F6 pages load nothing new).
 */
export function ensureLandingFonts(doc: Document, document: CrmLandingDocument | null | undefined): void {
  const fonts = [document?.theme?.font_heading, document?.theme?.font_body];
  for (const font of fonts) {
    const family = font ? GOOGLE_FAMILY[font] : undefined;
    if (!family) continue;
    const id = `landing-font-${font}`;
    if (doc.getElementById(id)) continue;
    const link = doc.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@400;600;700&display=swap`;
    doc.head.appendChild(link);
  }
}
