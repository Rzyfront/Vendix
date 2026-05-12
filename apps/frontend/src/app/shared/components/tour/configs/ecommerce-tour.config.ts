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
      title: 'Configura tu tienda online',
      description: 'Personaliza marca, catálogo y compra desde esta pantalla.',
    },
    {
      id: 'inicio-section',
      title: 'Apariencia',
      description: 'Define título, logo y colores de tu marca.',
      action: 'Revisa Inicio',
      target: '[data-tour="inicio-section"]',
      beforeNext: async () => {
        await new Promise(resolve => setTimeout(resolve, 500));
        return true;
      },
    },
    {
      id: 'slider-section',
      title: 'Slider principal',
      description: 'Muestra imágenes destacadas en la página de inicio.',
      action: 'Configura el slider',
      target: '[data-tour="slider-section"]',
      beforeNext: async () => {
        await new Promise(resolve => setTimeout(resolve, 500));
        return true;
      },
    },
    {
      id: 'catalog-section',
      title: 'Catálogo',
      description: 'Ajusta productos por página, reseñas, variantes y filtros.',
      action: 'Revisa el catálogo',
      target: '[data-tour="catalog-section"]',
      beforeNext: async () => {
        await new Promise(resolve => setTimeout(resolve, 500));
        return true;
      },
    },
    {
      id: 'checkout-section',
      title: 'Carrito y checkout',
      description: 'Define reglas del carrito, expiración y opciones de pago.',
      action: 'Revisa la compra',
      target: '[data-tour="checkout-section"]',
      beforeNext: async () => {
        await new Promise(resolve => setTimeout(resolve, 500));
        return true;
      },
    },
    {
      id: 'open-store-btn',
      title: 'Abre tu tienda',
      description: 'Usa "Abrir Tienda" para ver el sitio que compartirás.',
      action: 'Vista pública',
      target: 'app-sticky-header, .sticky-header',
      beforeNext: async () => {
        await new Promise(resolve => setTimeout(resolve, 500));
        return true;
      },
    },
    {
      id: 'congratulations',
      title: 'Tienda lista',
      description: 'Ya conoces las secciones clave para empezar a vender online.',
    },
  ],
};
