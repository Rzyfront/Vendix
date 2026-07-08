import { Stack } from 'expo-router';

/**
 * Layout del grupo Marketing. Es el grupo padre de:
 * - /marketing/promotions (lista + detalle + crear/editar)
 * - /marketing/coupons    (lista + stats + crear/editar)
 * - /marketing/anuncios   (lista + detalle + wizard 2-pasos + SSE streaming)
 *
 * El título visible en el breadcrumb lo pinta
 * `app/(store-admin)/_layout.tsx` (`routeTitles['marketing']`).
 * Las pantallas internas tienen su propio header via
 * `marketing/promotions/_layout.tsx` y `marketing/anuncios/_layout.tsx`.
 */
export default function MarketingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="promotions" />
      <Stack.Screen name="coupons" />
      <Stack.Screen name="social-sales" />
      <Stack.Screen name="anuncios" />
    </Stack>
  );
}
