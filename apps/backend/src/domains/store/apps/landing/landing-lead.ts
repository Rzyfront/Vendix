import { PublishedLandingOffer } from './landing-page.reader';

/** `crm_opportunities.title` is `VarChar(160)`. */
const MAX_TITLE = 160;

/** Origin label every landing lead carries in the CRM. */
export const LANDING_LEAD_ORIGIN = 'Landing page';

/**
 * Title of the pipeline card of a landing lead: origin and offer, so the
 * board says where the lead came from without opening it.
 */
export function buildLeadTitle(offer: PublishedLandingOffer): string {
  return `${LANDING_LEAD_ORIGIN} · ${offer.title}`.slice(0, MAX_TITLE);
}

/**
 * Body of the CRM note that keeps the lead's context: origin (landing and
 * its domain), offer and date, plus what the visitor wrote.
 */
export function buildLeadNote(params: {
  hostname: string;
  offer: PublishedLandingOffer;
  message: string;
  receivedAt: Date;
}): string {
  const { hostname, offer, message, receivedAt } = params;
  const lines = [
    `Lead desde la landing page`,
    `Origen: ${LANDING_LEAD_ORIGIN} (https://${hostname})`,
    `Oferta: ${offer.title} (${offer.mode === 'product' ? 'con producto' : 'informativa'})`,
  ];
  if (offer.product) {
    lines.push(`Producto: ${offer.product.name} (#${offer.product.id})`);
  }
  lines.push(`Fecha: ${receivedAt.toISOString()}`);
  lines.push('', `Mensaje: ${message}`);
  return lines.join('\n');
}
