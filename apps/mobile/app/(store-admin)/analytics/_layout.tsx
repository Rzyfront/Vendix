import { Stack } from 'expo-router';

export default function AnalyticsLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="sales" />
      <Stack.Screen name="sales/by-product" />
      <Stack.Screen name="sales/by-category" />
      <Stack.Screen name="sales/by-customer" />
      <Stack.Screen name="sales/by-payment" />
      <Stack.Screen name="sales/trends" />
      <Stack.Screen name="inventory" />
      <Stack.Screen name="financial" />
      <Stack.Screen name="products" />
    </Stack>
  );
}
