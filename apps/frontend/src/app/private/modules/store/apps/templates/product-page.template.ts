import {
  APP_PAGE_SCHEMA_VERSION,
  AppPageTemplate,
  cardsFields,
  ctaFields,
  faqFields,
  galleryFields,
  stepsFields,
  testimonialsFields,
  titleField,
} from './app-page.types';

/**
 * Product page base (reference: viapromeds.com — a page that sells one
 * product or one product line by itself). The product itself (gallery,
 * title, price and discount, variants, quantity and buy button) is the store's
 * product detail and always leads the page; these blocks go around it.
 *
 * Replace this file to change the product page base: the editor and the
 * public renderer read the blocks from here and from the backend catalog.
 */
export const PRODUCT_PAGE_TEMPLATE: AppPageTemplate = {
  kind: 'product_page',
  summary:
    'Una página que vende un producto sola: portada, el producto con precio, variantes y botón de compra, beneficios, cómo funciona, testimonios, complementos y preguntas frecuentes.',
  reference: 'viapromeds.com',
  blocks: [
    {
      type: 'benefits',
      label: 'Beneficios',
      description: 'Por qué elegir el producto, en tarjetas cortas.',
      icon: 'sparkles',
      fields: cardsFields('Beneficio'),
    },
    {
      type: 'how_it_works',
      label: 'Cómo funciona',
      description: 'Los pasos para comprar o usar el producto.',
      icon: 'list-ordered',
      fields: stepsFields(),
    },
    {
      type: 'specifications',
      label: 'Especificaciones',
      description: 'Tabla de características (medida, material, contenido…).',
      icon: 'list',
      fields: [
        titleField(),
        {
          key: 'items',
          label: 'Características',
          kind: 'list',
          max: 24,
          itemLabel: 'Característica',
          item: [
            { key: 'label', label: 'Nombre', kind: 'text', max: 60 },
            { key: 'value', label: 'Valor', kind: 'text', max: 200 },
          ],
        },
      ],
    },
    {
      type: 'gallery',
      label: 'Galería',
      description: 'Fotos adicionales del producto en uso.',
      icon: 'image',
      fields: galleryFields(),
    },
    {
      type: 'testimonials',
      label: 'Testimonios',
      description: 'Lo que dicen tus clientes, con nombre, ciudad y estrellas.',
      icon: 'star',
      fields: testimonialsFields(),
    },
    {
      type: 'complements',
      label: 'Complementos',
      description: 'Los productos complementarios que elegiste en "Producto y dominio".',
      icon: 'package-plus',
      existing: true,
      fields: [titleField()],
    },
    {
      type: 'shipping_warranty',
      label: 'Envío y garantía',
      description: 'Cómo llega, qué garantía tiene y cómo se devuelve.',
      icon: 'truck',
      fields: [
        titleField(),
        { key: 'shipping', label: 'Envío', kind: 'text', max: 500, multiline: true },
        { key: 'warranty', label: 'Garantía', kind: 'text', max: 500, multiline: true },
        { key: 'returns', label: 'Devoluciones', kind: 'text', max: 500, multiline: true },
      ],
    },
    {
      type: 'faq',
      label: 'Preguntas frecuentes',
      description: 'Resuelve las dudas antes de la compra.',
      icon: 'help-circle',
      fields: faqFields(),
    },
    {
      type: 'cta',
      label: 'Llamado final',
      description: 'Cierre de la página con un botón de compra.',
      icon: 'mouse-pointer-click',
      fields: ctaFields(),
    },
  ],
  page: {
    schema_version: APP_PAGE_SCHEMA_VERSION,
    mode: 'sales',
    sales: { product_mode: 'single', show_cart: true, checkout: 'store' },
    hero: {
      eyebrow: 'Nuevo',
      title: 'El producto que estabas buscando',
      subtitle: 'Calidad garantizada, envío a todo el país y pago seguro.',
      button_label: 'Comprar ahora',
    },
    blocks: [
      {
        id: 'benefits',
        type: 'benefits',
        enabled: true,
        props: {
          title: 'Por qué elegirlo',
          items: [
            { title: 'Calidad comprobada', text: 'Materiales seleccionados y control en cada unidad.' },
            { title: 'Envío rápido', text: 'Lo despachamos el mismo día hábil.' },
            { title: 'Pago seguro', text: 'Paga en línea o contra entrega.' },
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
            { title: 'Elige', text: 'Escoge la presentación y la cantidad.' },
            { title: 'Paga', text: 'Completa tu compra en pocos pasos.' },
            { title: 'Recibe', text: 'Te lo llevamos a la puerta.' },
          ],
        },
      },
      {
        id: 'specifications',
        type: 'specifications',
        enabled: false,
        props: { title: 'Especificaciones', items: [] },
      },
      {
        id: 'testimonials',
        type: 'testimonials',
        enabled: true,
        props: {
          title: 'Lo que dicen nuestros clientes',
          rating_summary: '4.9/5',
          items: [
            { name: 'Laura', city: 'Bogotá', quote: 'Llegó rapidísimo y es tal cual la foto.', rating: 5 },
            { name: 'Andrés', city: 'Medellín', quote: 'Excelente calidad, ya pedí el segundo.', rating: 5 },
          ],
        },
      },
      { id: 'complements', type: 'complements', enabled: true, props: { title: 'Complementa tu compra' } },
      {
        id: 'shipping-warranty',
        type: 'shipping_warranty',
        enabled: true,
        props: {
          title: 'Envío y garantía',
          shipping: 'Envío a todo el país. Entrega de 1 a 5 días hábiles.',
          warranty: 'Garantía por defectos de fábrica.',
          returns: 'Si no te convence, puedes devolverlo en los primeros 5 días.',
        },
      },
      {
        id: 'faq',
        type: 'faq',
        enabled: true,
        props: {
          title: 'Preguntas frecuentes',
          items: [
            { question: '¿Cuánto tarda el envío?', answer: 'Entre 1 y 5 días hábiles según tu ciudad.' },
            { question: '¿Qué medios de pago aceptan?', answer: 'Los mismos de nuestra tienda en línea.' },
          ],
        },
      },
      {
        id: 'cta',
        type: 'cta',
        enabled: true,
        props: { title: '¿Listo para tenerlo?', text: 'Pide hoy y recíbelo en casa.', button_label: 'Comprar ahora' },
      },
    ],
  },
};
