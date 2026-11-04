import { APP_PAGE_SCHEMA_VERSION, AppPageVariant } from './app-page.types';

/**
 * Product page · «Clínico/limpio»: a clear, trust-first product page for
 * health, care or technical products. Specifications and how it works lead,
 * then guarantees and FAQ; white background, sans-serif, small corners and
 * square images. Data only: same blocks as the base.
 *
 * Contrast (WCAG): text 16.7:1, secondary text 8.3:1, button 5.8:1, accent
 * 5.3:1 — all above 4.5:1.
 */
export const PRODUCT_PAGE_CLINICAL: AppPageVariant = {
  id: 'clinical',
  name: 'Clínico/limpio',
  description: 'Clara y confiable: ficha técnica, cómo funciona y garantías primero, sobre fondo blanco.',
  page: {
    schema_version: APP_PAGE_SCHEMA_VERSION,
    theme: {
      primary_color: '#0F6E8C',
      secondary_color: '#0B4F66',
      surface_color: '#FFFFFF',
      text_color: '#0F172A',
      accent_color: '#0B7A5B',
      heading_font: 'inter',
      body_font: 'inter',
      radius: 'small',
      density: 'comfortable',
      button_style: 'solid',
      image_style: 'square',
      content_width: 'normal',
    },
    hero: {
      eyebrow: 'Calidad certificada',
      title: 'Resultados que puedes comprobar',
      subtitle: 'Información clara, componentes verificados y asesoría antes y después de tu compra.',
      button_label: 'Ver detalles',
    },
    blocks: [
      {
        id: 'specifications',
        type: 'specifications',
        enabled: true,
        props: {
          title: 'Ficha técnica',
          items: [
            { label: 'Presentación', value: 'Indica el tamaño o la cantidad.' },
            { label: 'Uso', value: 'Describe cómo y cuándo usarlo.' },
            { label: 'Registro', value: 'Agrega el registro o la certificación.' },
          ],
        },
      },
      {
        id: 'how-it-works',
        type: 'how_it_works',
        enabled: true,
        props: {
          title: 'Cómo funciona',
          items: [
            { title: 'Consulta', text: 'Revisa la ficha y resuelve tus dudas con nosotros.' },
            { title: 'Compra', text: 'Paga en línea de forma segura.' },
            { title: 'Seguimiento', text: 'Te acompañamos durante el uso.' },
          ],
        },
      },
      {
        id: 'benefits',
        type: 'benefits',
        enabled: true,
        props: {
          title: 'Por qué confiar',
          items: [
            { title: 'Componentes verificados', text: 'Cada lote pasa control de calidad.' },
            { title: 'Asesoría profesional', text: 'Un equipo que responde tus preguntas.' },
            { title: 'Privacidad', text: 'Empaque discreto y datos protegidos.' },
          ],
        },
      },
      {
        id: 'shipping-warranty',
        type: 'shipping_warranty',
        enabled: true,
        props: {
          title: 'Garantías',
          shipping: 'Despacho en 24 horas hábiles.',
          warranty: 'Producto original garantizado.',
          returns: 'Devolución sin costo si llega en mal estado.',
        },
      },
      {
        id: 'faq',
        type: 'faq',
        enabled: true,
        props: {
          title: 'Preguntas frecuentes',
          items: [
            { question: '¿Necesito fórmula o receta?', answer: 'Indícalo según tu producto.' },
            { question: '¿Cuánto tarda el envío?', answer: 'Entre 1 y 3 días hábiles en ciudades principales.' },
          ],
        },
      },
      {
        id: 'testimonials',
        type: 'testimonials',
        enabled: true,
        props: {
          title: 'Opiniones verificadas',
          rating_summary: '4.8/5',
          items: [{ name: 'Mónica', city: 'Medellín', quote: 'Claro, serio y llegó al día siguiente.', rating: 5 }],
        },
      },
      { id: 'complements', type: 'complements', enabled: true, props: { title: 'Complementa tu compra' } },
      {
        id: 'cta',
        type: 'cta',
        enabled: true,
        props: { title: '¿Tienes dudas?', text: 'Compra con asesoría incluida.', button_label: 'Comprar ahora' },
      },
      { id: 'gallery', type: 'gallery', enabled: false, props: { title: 'Imágenes' } },
    ],
  },
};
