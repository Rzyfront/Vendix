import { useLocalSearchParams } from 'expo-router';
import { CategoryForm } from '@/features/store/components/category-form';

export default function CategoryEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CategoryForm mode="edit" categoryId={Number(id)} />;
}