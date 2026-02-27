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
      // Desktop: Target the first product card in the POS product selection
      targetDesktop: 'app-pos-product-selection .product-card:first-of-type',
      // Mobile: Precise selectors based on actual component structure
      // The product cards in pos-product-selection.component.ts have:
      // - class="product-card group relative bg-surface border border-border rounded-2xl"
      // Priority:
      // 1. Most specific: product-card class inside POS component
      // 2. Fallback: rounded-2xl with group class (all product cards have both)
      // 3. Fallback: any product-card on page
      // 4. Fallback: grid items (child of grid with rounded-2xl)
      targetMobile: 'app-pos-product-selection .product-card, app-pos-product-selection .group.rounded-2xl, .product-card, app-pos-product-selection .grid > div > div.rounded-2xl',
      // Fallback for older configs
      target: 'app-pos-product-selection .product-card',
      // Click detection targets - same for both desktop and mobile
      autoAdvanceTargetDesktop: 'app-pos-product-selection .product-card:first-of-type',
      autoAdvanceTargetMobile: 'app-pos-product-selection .product-card, .product-card, .group.rounded-2xl',
      beforeNext: async () => {
        console.log('[POS Tour] Validating product added to cart, isMobile:', window.innerWidth < 1024);

        // Wait a moment for the cart to update
        await new Promise(resolve => setTimeout(resolve, 800));

        // Check if cart has items by looking for the cart badge or cart modal trigger
        const isDesktop = window.innerWidth >= 1024;
        console.log('[POS Tour] Device is desktop:', isDesktop);

        if (isDesktop) {
          const cartItems = document.querySelectorAll('app-pos-cart .group, app-pos-cart app-quantity-control');
          console.log('[POS Tour] Desktop cart items found:', cartItems.length);
          if (cartItems.length > 0) return true;
        }

        // Mobile: Check for cart badge in footer or non-zero total
        const cartBadge = document.querySelector('.pos-mobile-footer .cart-badge');
        console.log('[POS Tour] Mobile cart badge:', cartBadge?.textContent);
        if (cartBadge) {
          const badgeText = cartBadge?.textContent ?? '';
          const hasItems = badgeText.trim() !== '' && badgeText !== '0' && badgeText !== '99+';
          if (hasItems) return true;
        }

        // Check total amount (works on both)
        const totalElements = document.querySelectorAll('.total-amount, .font-extrabold, .text-2xl');
        console.log('[POS Tour] Total elements found:', totalElements.length);
        for (const el of Array.from(totalElements)) {
          const text = el?.textContent ?? '';
          console.log('[POS Tour] Total text:', text);
          if (text.length > 0 && !text.includes('0.00') && !text.includes('0') && !text.includes('Total')) {
            return true;
          }
        }

        console.log('[POS Tour] Cart validation failed');
        return false;
      },
    },
    {
      id: 'checkout',
      title: 'Procesa el Pago',
      description: 'Cuando estés listo, haz clic en el botón "Cobrar" para procesar el pago y completar la venta.',
      action: 'Haz clic en el botón "Cobrar"',
      // Desktop: Target the "Cobrar" button in the cart component
      targetDesktop: 'app-pos-cart button.checkout-btn',
      // Mobile: Target the "Cobrar" button in the mobile footer
      targetMobile: 'app-pos-mobile-footer button.checkout-btn',
      // Fallback for older configs
      target: 'app-pos-cart button.checkout-btn',
      // Click detection targets
      autoAdvanceTargetDesktop: 'app-pos-cart button.checkout-btn',
      autoAdvanceTargetMobile: 'app-pos-mobile-footer button.checkout-btn',
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
