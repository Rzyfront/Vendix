import { useLocalSearchParams } from 'expo-router';
import { BrandForm } from '@/features/store/components/brand-form';

export default function BrandEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <BrandForm mode="edit" brandId={Number(id)} />;
}