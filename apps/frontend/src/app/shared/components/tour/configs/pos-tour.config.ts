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
      title: 'Bienvenido a Vendix',
      description:
        'Crea un producto, véndelo en POS y completa tu primera prueba.',
      // No target - centered tooltip
    },
    {
      id: 'go-to-products',
      title: 'Productos',
      description:
        'Primero crea un producto para vender.',
      action: 'Abre Productos',
      target: 'app-sidebar a[href="/admin/products"]',
      beforeNext: async () => {
        const currentPath = window.location.pathname;
        return currentPath.includes('/admin/products');
      },
    },
    {
      id: 'click-new-product',
      title: 'Primer producto',
      description:
        'Usa "Crear Primer Producto" o "Nuevo Producto".',
      action: 'Crea el producto',
      // Try to find the "Crear Primer Producto" button in empty state first,
      // otherwise fall back to the dropdown action
      target:
        'app-empty-state app-button[variant="primary"], app-options-dropdown button.action-item',
      beforeNext: async () => {
        // Wait a moment for the modal/form to appear
        await new Promise((resolve) => setTimeout(resolve, 500));
        // Check if product form or modal is visible
        const form = document.querySelector(
          'app-product-create-modal, app-product-create-page, form[class*="product"]',
        );
        return !!form;
      },
    },
    {
      id: 'fill-product-form',
      title: 'Configura el producto',
      description:
        'Completa nombre, precio y stock. Agrega más datos si lo necesitas.',
      action: 'Luego continúa',
      // No target - the user fills the form and clicks next manually
      beforeNext: async () => {
        // Allow proceeding - user will click next manually
        await new Promise((resolve) => setTimeout(resolve, 500));
        return true;
      },
    },
    {
      id: 'go-to-pos',
      title: 'Punto de venta',
      description:
        'Ahora procesa la venta desde el POS.',
      action: 'Abre Punto de Venta',
      target: 'app-sidebar a[href="/admin/pos"]',
      beforeNext: async () => {
        const currentPath = window.location.pathname;
        return currentPath.includes('/admin/pos');
      },
    },
    {
      id: 'add-product-to-cart',
      title: 'Agrega al carrito',
      description:
        'Toca un producto y el total se actualizará.',
      action: 'Selecciona un producto',
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
      targetMobile:
        'app-pos-product-selection .product-card, app-pos-product-selection .group.rounded-2xl, .product-card, app-pos-product-selection .grid > div > div.rounded-2xl',
      // Fallback for older configs
      target: 'app-pos-product-selection .product-card',
      // Click detection targets - same for both desktop and mobile
      autoAdvanceTargetDesktop:
        'app-pos-product-selection .product-card:first-of-type',
      autoAdvanceTargetMobile:
        'app-pos-product-selection .product-card, .product-card, .group.rounded-2xl',
      beforeNext: async () => {
        // Wait a moment for the cart to update
        await new Promise((resolve) => setTimeout(resolve, 800));

        // Check if cart has items by looking for the cart badge or cart modal trigger
        const isDesktop = window.innerWidth >= 1024;

        if (isDesktop) {
          const cartItems = document.querySelectorAll(
            'app-pos-cart .group, app-pos-cart app-quantity-control',
          );
          if (cartItems.length > 0) return true;
        }

        // Mobile: Check for cart badge in footer or non-zero total
        const cartBadge = document.querySelector(
          '.pos-mobile-footer .cart-badge',
        );
        if (cartBadge) {
          const badgeText = cartBadge?.textContent ?? '';
          const hasItems =
            badgeText.trim() !== '' && badgeText !== '0' && badgeText !== '99+';
          if (hasItems) return true;
        }

        // Check total amount (works on both)
        const totalElements = document.querySelectorAll(
          '.total-amount, .font-extrabold, .text-2xl',
        );
        for (const el of Array.from(totalElements)) {
          const text = el?.textContent ?? '';
          if (
            text.length > 0 &&
            !text.includes('0.00') &&
            !text.includes('0') &&
            !text.includes('Total')
          ) {
            return true;
          }
        }

        return false;
      },
    },
    {
      id: 'checkout',
      title: 'Procesa el pago',
      description:
        'Usa "Cobrar" para abrir el pago y cerrar la venta.',
      action: 'Cobra la venta',
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
        await new Promise((resolve) => setTimeout(resolve, 500));
        return true;
      },
    },
    {
      id: 'congratulations',
      title: 'Excelente',
      description:
        'Completa el pago y revisa tus órdenes cuando quieras.',
      // No target - centered
    },
  ],
};
