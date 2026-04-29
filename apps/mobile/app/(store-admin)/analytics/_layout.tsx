import { Stack } from 'expo-router';

export default function AnalyticsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="sales" />
      <Stack.Screen name="inventory" />
      <Stack.Screen name="financial" />
      <Stack.Screen name="products" />
    </Stack>
  );
}
