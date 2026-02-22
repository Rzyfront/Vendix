import { TourConfig } from '../services/tour.service';

/**
 * Ecommerce Configuration Tour Configuration
 *
 * This tour guides store admins through their first visit to the ecommerce configuration page.
 * It highlights the key features for setting up their online store.
 *
 * Flow:
 * 1. Welcome - Introduction to ecommerce configuration
 * 2. Inicio Section - Store branding (logo, title, colors)
 * 3. Slider Section - Homepage slider configuration
 * 4. Catalog Section - Product catalog settings
 * 5. Checkout Section - Cart and payment settings
 * 6. Store Link - Highlight the "Abrir Tienda" button in header
 */
export const ECOMMERCE_TOUR_CONFIG: TourConfig = {
  id: 'ecommerce-config-first-visit',
  name: 'Tour de Configuración Ecommerce',
  showProgress: true,
  showSkipButton: true,
  steps: [
    {
      id: 'welcome',
      title: '¡Bienvenido a la Configuración de tu Tienda Online! 🛍️',
      description: 'Aquí puedes personalizar todos los aspectos de tu tienda e-commerce. Desde el logo y colores hasta cómo se muestran tus productos y el proceso de compra.',
      action: 'Haz clic en "Comenzar" para configurar tu tienda',
    },
    {
      id: 'inicio-section',
      title: 'Personaliza la Apariencia de tu Tienda',
      description: 'Define la identidad visual de tu tienda: configura el título de bienvenida, sube tu logo y elige los colores que representan tu marca. ¡Haz que tu tienda sea única!',
      action: 'Revisa la sección de Inicio',
      target: '[data-tour="inicio-section"]',
      beforeNext: async () => {
        await new Promise(resolve => setTimeout(resolve, 500));
        return true;
      },
    },
    {
      id: 'slider-section',
      title: 'Destaca tus Productos con un Slider',
      description: 'Activa el slider para mostrar un carrusel de imágenes en la página de inicio. Puedes agregar hasta 5 imágenes con títulos y descripciones para captar la atención de tus clientes.',
      action: 'Configura tu slider principal',
      target: '[data-tour="slider-section"]',
      beforeNext: async () => {
        await new Promise(resolve => setTimeout(resolve, 500));
        return true;
      },
    },
    {
      id: 'catalog-section',
      title: 'Configura tu Catálogo de Productos',
      description: 'Define cómo se muestran tus productos: cantidad por página, si permites reseñas, variantes, productos relacionados y filtros de búsqueda.',
      action: 'Personaliza la configuración del catálogo',
      target: '[data-tour="catalog-section"]',
      beforeNext: async () => {
        await new Promise(resolve => setTimeout(resolve, 500));
        return true;
      },
    },
    {
      id: 'checkout-section',
      title: 'Configura el Carrito y Checkout',
      description: 'Establece las reglas del carrito de compras, tiempo de expiración y opciones de pago como el checkout por WhatsApp.',
      action: 'Configura las opciones de compra',
      target: '[data-tour="checkout-section"]',
      beforeNext: async () => {
        await new Promise(resolve => setTimeout(resolve, 500));
        return true;
      },
    },
    {
      id: 'open-store-btn',
      title: '¡Abre tu Tienda al Mundo!',
      description: 'Una vez configurada, usa el botón "Abrir Tienda" en la cabecera para ver cómo se ve tu tienda online. Ese es el enlace que compartirás con tus clientes.',
      action: 'Haz clic en "Abrir Tienda" para ver tu tienda',
      target: 'app-sticky-header, .sticky-header',
      beforeNext: async () => {
        await new Promise(resolve => setTimeout(resolve, 500));
        return true;
      },
    },
    {
      id: 'congratulations',
      title: '¡Tu Tienda Online Está Lista! 🎉',
      description: 'Has completado el tour de configuración. Ahora puedes personalizar cada sección a tu gusto y empezar a vender online. ¡Mucho éxito en tus ventas!',
      action: '¡Comienza a configurar tu tienda!',
    },
  ],
};
