import { Stack } from 'expo-router';

export default function InvoicingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
      <Stack.Screen name="resolutions" />
      <Stack.Screen name="dian-config" />
    </Stack>
  );
}
