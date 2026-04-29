import { Stack } from 'expo-router';

export default function InventoryLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="adjustments" />
      <Stack.Screen name="transfers" />
      <Stack.Screen name="movements" />
      <Stack.Screen name="suppliers" />
      <Stack.Screen name="locations" />
    </Stack>
  );
}
