import { Stack } from 'expo-router';

/**
 * Sub-layout de Promociones. Habilita header en las pantallas internas
 * (la lista y el detalle pintan su propio `StickyHeader` con título,
 * subtítulo y acciones — ver `index.tsx` y `[id].tsx`).
 */
export default function PromotionsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
    </Stack>
  );
}