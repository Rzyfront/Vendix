import { Stack } from 'expo-router';

export default function AccountingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="chart-of-accounts" />
      <Stack.Screen name="journal-entries" />
      <Stack.Screen name="[journalEntryId]" />
      <Stack.Screen name="fiscal-periods" />
      <Stack.Screen name="receivables" />
      <Stack.Screen name="payables" />
    </Stack>
  );
}
