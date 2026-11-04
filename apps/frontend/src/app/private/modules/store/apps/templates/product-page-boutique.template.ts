import { APP_PAGE_SCHEMA_VERSION, AppPageVariant } from './app-page.types';

/**
 * Product page · «Boutique»: a premium, editorial product page. Story first
 * (gallery slot, benefits and testimonials lead), generous spacing, serif titles, warm
 * neutral palette and outline buttons. Data only: same blocks as the base.
 *
 * Contrast (WCAG): text 13.8:1, secondary text 6.9:1, button 8.2:1, outline
 * button 7.7:1, accent 5.5:1 — all above 4.5:1.
 */
export const PRODUCT_PAGE_BOUTIQUE: AppPageVariant = {
  id: 'boutique',
  name: 'Boutique',
  description: 'Elegante y pausada: beneficios y testimonios primero (y la galería arriba en cuanto subas tus fotos), títulos con serifa y tonos cálidos.',
  page: {
    schema_version: APP_PAGE_SCHEMA_VERSION,
    theme: {
      primary_color: '#7A3E2E',
      secondary_color: '#5C4033',
      surface_color: '#FBF7F2',
      text_color: '#2B211C',
      accent_color: '#8C5A2B',
      heading_font: 'playfair',
      body_font: 'lora',
      radius: 'large',
      density: 'spacious',
      button_style: 'outline',
      image_style: 'rounded',
      content_width: 'narrow',
    },
    hero: {
      eyebrow: 'Edición especial',
      title: 'Hecho con cuidado, pensado para durar',
      subtitle: 'Una pieza que se nota desde el primer día. Envío cuidadoso y empaque de regalo.',
      button_label: 'Descubrir',
    },
    blocks: [
      // First on the page; off until the owner adds its images (an empty gallery shows only its title).
      { id: 'gallery', type: 'gallery', enabled: false, props: { title: 'En detalle' } },
      {
        id: 'benefits',
        type: 'benefits',
        enabled: true,
        props: {
          title: 'Lo que lo hace único',
          items: [
            { title: 'Materiales nobles', text: 'Seleccionados uno a uno por su calidad y su tacto.' },
            { title: 'Hecho a mano', text: 'Terminado por artesanos, con atención a cada detalle.' },
            { title: 'Listo para regalar', text: 'Llega en empaque de regalo sin costo adicional.' },
          ],
        },
      },
      {
        id: 'testimonials',
        type: 'testimonials',
        enabled: true,
        props: {
          title: 'Quienes ya lo tienen',
          rating_summary: '4.9/5',
          items: [
            { name: 'Valentina', city: 'Bogotá', quote: 'La calidad se siente apenas lo abres. Precioso.', rating: 5 },
            { name: 'Camilo', city: 'Cali', quote: 'Lo compré para regalar y fue un éxito.', rating: 5 },
          ],
        },
      },
      { id: 'complements', type: 'complements', enabled: true, props: { title: 'Combínalo con' } },
      {
        id: 'shipping-warranty',
        type: 'shipping_warranty',
        enabled: true,
        props: {
          title: 'Compra con tranquilidad',
          shipping: 'Envío asegurado a todo el país.',
          warranty: 'Garantía de calidad en cada pieza.',
          returns: 'Si no te enamora, lo cambiamos.',
        },
      },
      {
        id: 'faq',
        type: 'faq',
        enabled: true,
        props: {
          title: 'Preguntas frecuentes',
          items: [
            { question: '¿Puedo enviarlo como regalo?', answer: 'Sí. Escríbenos la dedicatoria y lo enviamos sin precios.' },
            { question: '¿Cómo lo cuido?', answer: 'Incluimos una guía de cuidado en cada pedido.' },
          ],
        },
      },
      {
        id: 'cta',
        type: 'cta',
        enabled: true,
        props: { title: 'Hazlo tuyo', text: 'Unidades limitadas en esta edición.', button_label: 'Comprar' },
      },
      { id: 'how-it-works', type: 'how_it_works', enabled: false, props: { title: 'Cómo funciona', items: [] } },
      { id: 'specifications', type: 'specifications', enabled: false, props: { title: 'Ficha técnica', items: [] } },
    ],
  },
};
