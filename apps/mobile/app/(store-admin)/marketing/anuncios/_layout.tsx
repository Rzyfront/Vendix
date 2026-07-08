import { Stack } from 'expo-router';

/**
 * Sub-layout del grupo `marketing/anuncios`.
 * Las pantallas internas (list, detail, create) tienen su propio header
 * via `StickyHeader` (en paridad con la UI web), por eso `headerShown: false`.
 */
export default function AnunciosLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
      <Stack.Screen name="create" />
    </Stack>
  );
}
