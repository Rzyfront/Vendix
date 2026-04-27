import { Stack } from 'expo-router';

export default function OrgAdminLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: '#ffffff' },
        headerTitleStyle: { color: '#0f172a' },
      }}
    />
  );
}
