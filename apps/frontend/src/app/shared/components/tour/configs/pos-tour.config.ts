import { TourConfig } from '../services/tour.service';

/**
 * POS First Sale Tour Configuration
 *
 * This tour guides users through their first sale with VALIDATION.
 * Each step requires user action before proceeding.
 *
 * Flow:
 * 1. Welcome (no target)
 * 2. Go to Products page (sidebar link)
 * 3. Click "Crear Primer Producto" button (empty state) or "Nuevo Producto" (dropdown)
 * 4. Fill product form and save
 * 5. Go to POS page (sidebar link)
 * 6. Click on a product card to add to cart
 * 7. Click "Cobrar" button to proceed to payment
 * 8. Congratulations (no target)
 */
export const POS_TOUR_CONFIG: TourConfig = {
  id: 'pos-first-sale',
  name: 'Primera Venta en POS',
  showProgress: true,
  showSkipButton: true,
  steps: [
    {
      id: 'welcome',
      title: '¡Bienvenido a Vendix! 🚀',
      description: 'Estás a punto de comenzar el proceso para llevar tu negocio al siguiente nivel. Este tutorial te ayudará a realizar tus primeras ventas de prueba.',
      action: 'Haz clic en "Comenzar" para iniciar',
      // No target - centered tooltip
    },
    {
      id: 'go-to-products',
      title: 'Gestiona tus Productos',
      description: 'Estoy seguro que tu negocio maneja productos. Vamos a crear algunos para que puedas empezar a vender.',
      action: 'Haz clic en "Productos" en el menú lateral',
      target: 'app-sidebar a[href="/admin/products"]',
      beforeNext: async () => {
        const currentPath = window.location.pathname;
        return currentPath.includes('/admin/products');
      },
    },
    {
      id: 'click-new-product',
      title: 'Crea tu Primer Producto',
      description: 'Haz clic en el botón "Crear Primer Producto" o "Nuevo Producto" para agregar tu primer item al inventario.',
      action: 'Busca y haz clic en el botón de crear producto',
      // Try to find the "Crear Primer Producto" button in empty state first,
      // otherwise fall back to the dropdown action
      target: 'app-product-empty-state app-button[variant="primary"], app-options-dropdown button.action-item',
      beforeNext: async () => {
        // Wait a moment for the modal/form to appear
        await new Promise(resolve => setTimeout(resolve, 500));
        // Check if product form or modal is visible
        const form = document.querySelector('app-product-create-modal, app-product-create-page, form[class*="product"]');
        return !!form;
      },
    },
    {
      id: 'fill-product-form',
      title: 'Configura tu Producto',
      description: 'Completa los campos requeridos: nombre del producto, precio y cantidad en stock. También puedes usar "Configuración Avanzada" para más opciones.',
      action: 'Llena el formulario y haz clic en "Siguiente" cuando termines',
      // No target - the user fills the form and clicks next manually
      beforeNext: async () => {
        // Allow proceeding - user will click next manually
        await new Promise(resolve => setTimeout(resolve, 500));
        return true;
      },
    },
    {
      id: 'go-to-pos',
      title: 'Punto de Venta',
      description: 'El Punto de Venta (POS) es donde procesas todas tus transacciones. Es rápido, intuitivo y te ayuda a vender más.',
      action: 'Haz clic en "Punto de Venta" en el menú lateral',
      target: 'app-sidebar a[href="/admin/pos"]',
      beforeNext: async () => {
        const currentPath = window.location.pathname;
        return currentPath.includes('/admin/pos');
      },
    },
    {
      id: 'add-product-to-cart',
      title: 'Agrega Productos al Carrito',
      description: 'Haz clic en cualquier producto de la lista para agregarlo al carrito. Verás cómo se actualiza el total automáticamente.',
      action: 'Haz clic en un producto para agregarlo',
      // Target the first product card in the POS product selection
      target: 'app-pos-product-selection .product-card:first-of-type',
      beforeNext: async () => {
        // Wait a moment for the cart to update
        await new Promise(resolve => setTimeout(resolve, 800));

        // Check if cart has items by looking for the quantity control or cart content
        // The cart items have a "group" class and contain quantity controls
        const cartItems = document.querySelectorAll('app-pos-cart .group, app-pos-cart app-quantity-control');
        const hasCartContent = cartItems.length > 0;

        // Also check if the total has changed (not 0)
        const totalElement = document.querySelector('app-pos-cart .text-2xl, app-pos-cart .font-extrabold');
        const totalText = totalElement?.textContent ?? '';
        const hasNonZeroTotal = totalText.length > 0 && !totalText.includes('0.00');

        return hasCartContent || hasNonZeroTotal;
      },
    },
    {
      id: 'checkout',
      title: 'Procesa el Pago',
      description: 'Cuando estés listo, haz clic en el botón "Cobrar" para procesar el pago y completar la venta.',
      action: 'Haz clic en el botón "Cobrar"',
      // Target the "Cobrar" button in the cart component
      target: 'app-pos-cart button.checkout-btn',
      beforeNext: async () => {
        // Allow proceeding - payment modal will open
        await new Promise(resolve => setTimeout(resolve, 500));
        return true;
      },
    },
    {
      id: 'congratulations',
      title: '¡Excelente! 🎉',
      description: 'Aquí podrás completar tu venta y luego podrás revisar en el apartado de órdenes, para ver como tu negocio crece exponencialmente.',
      action: '¡Excelente trabajo! Tu negocio está en marcha.',
      // No target - centered
    },
  ],
};
