# Edge cases y flujos

- Deep linking protegido:
  - Usuario visita /admin/orders/123 sin sesión → AuthGuard guarda returnUrl.
  - Tras login, PostLoginLayoutGuard verifica acceso; si permitido, navega a returnUrl, si no, a layout permitido y muestra aviso.

- Dominio ≠ Organización del usuario:
  - Branding y host son de A, pero el usuario pertenece a B. UI conserva branding A; DataScope usa B.

- Usuario con múltiples roles:
  - Preferencia respetada si permitida; sino prioridad: superadmin > admin > pos > storefront.

- Usuario sin layouts permitidos:
  - Mostrar /auth/forbidden o soporte.

- SSR:
  - DomainAppGuard debe poder resolver `DomainConfig` del request; ThemeService aplica CSS server-side.

- Cliente en dominio de tienda intentando /admin:
  - LayoutAccessGuard bloquea y envía a /shop.

- Owner en Vendix Landing:
  - Branding Vendix + Admin layout + datos de su org.
