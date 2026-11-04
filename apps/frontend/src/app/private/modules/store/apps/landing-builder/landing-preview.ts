import type { CrmLandingDocument } from '../../../../../public/dynamic-landing/blocks/landing-blocks.types';
import type { LandingOffer } from '../../../../../public/landing-page/landing-page.service';

/** Real store products the public read injects into `products_grid` (backend `PublicLandingProduct`). */
export interface LandingPreviewProduct {
  name: string;
  slug: string;
  price: number | null;
  image_url: string | null;
}

/** GET /store/crm/landing/preview-context */
export interface LandingPreviewContext {
  products: LandingPreviewProduct[];
  ecommerce_base_url: string | null;
}

/** What the editor posts to the landing preview frame on every change. */
export interface LandingPreviewPayload {
  /** The draft, hidden sections included (the view skips them). */
  document: CrmLandingDocument;
  context: LandingPreviewContext;
  /** The offer the landing shows on its own domain. */
  offer: LandingOffer | null;
  storeName: string;
  /** Store branding logo; the draft's `theme.logo_url` wins over it. */
  storeLogoUrl: string | null;
}

/**
 * The document the public page would receive: the same products the backend
 * injects into every products grid (`CrmPublicService.enrichProductsGrid`),
 * only when the store has some.
 */
export function withPreviewProducts(
  document: CrmLandingDocument,
  products: readonly LandingPreviewProduct[],
): CrmLandingDocument {
  if (products.length === 0) return document;
  return {
    ...document,
    blocks: document.blocks.map((block) =>
      block.type === 'products_grid' ? { ...block, props: { ...block.props, items: [...products] } } : block,
    ),
  };
}

/** Route of the frame, outside the admin layout (see `store_admin.routes.ts`). */
export const LANDING_PREVIEW_FRAME_ROUTE = '/admin/apps/landing/preview-frame';

/** The landing's offer as the owner edits it in General. */
export interface LandingOfferDraft {
  mode: 'info' | 'product';
  title: string;
  description: string;
  product: { id: number; name: string; slug: string } | null;
}

/**
 * The offer the public page would show, resolved like the backend
 * (`resolveLandingOffer` in `landing-page.reader.ts`): a product offer without
 * a product falls back to the informative one, and an empty title takes the
 * same default.
 */
export function resolvePreviewOffer(draft: LandingOfferDraft): LandingOffer {
  const sellsProduct = draft.mode === 'product' && !!draft.product;
  return {
    mode: sellsProduct ? 'product' : 'info',
    title: draft.title.trim() || (sellsProduct ? draft.product!.name : 'Déjanos tus datos y te contactamos'),
    description: draft.description.trim() || null,
    product: sellsProduct ? { ...draft.product! } : null,
  };
}
