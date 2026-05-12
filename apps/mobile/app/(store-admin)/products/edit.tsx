import { useLocalSearchParams } from 'expo-router';
import { ProductUpsertForm } from '@/features/store/components/product-upsert-form';

export default function EditProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ProductUpsertForm mode="edit" productId={Number(id)} />;
}
