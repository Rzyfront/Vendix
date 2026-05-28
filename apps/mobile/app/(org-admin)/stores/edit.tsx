import { useLocalSearchParams } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { StoreUpsertForm } from '@/features/org/components/store-upsert-form';
import { colorScales } from '@/shared/theme';

export default function EditStoreScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  if (!id) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>ID de tienda no encontrado</Text>
      </View>
    );
  }

  return <StoreUpsertForm mode="edit" storeId={Number(id)} />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colorScales.gray[50],
  },
  error: {
    color: colorScales.red[600],
    fontSize: 16,
  },
});
