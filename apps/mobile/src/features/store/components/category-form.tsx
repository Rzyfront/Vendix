import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Input, Textarea, Toggle, Card, StickyHeader } from '@/shared/components';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { CategoryService } from '@/features/store/services/category.service';
import type { ProductCategory, CreateCategoryDto, UpdateCategoryDto } from '@/features/store/types';
import { colors, spacing } from '@/shared/theme';

interface CategoryFormProps {
  mode: 'create' | 'edit';
  categoryId?: number;
}

export function CategoryForm({ mode, categoryId }: CategoryFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEdit = mode === 'edit';

  const { data: existing, isLoading } = useQuery({
    queryKey: ['category', categoryId],
    queryFn: () => CategoryService.getById(categoryId!),
    enabled: isEdit && !!categoryId,
  });

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [isFeatured, setIsFeatured] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Hydrate form when loading existing category. Done in useEffect to avoid
  // calling state setters during render — that triggers an infinite
  // re-render loop that kills the React Native runtime on the device.
  useEffect(() => {
    if (!isEdit || !existing || initialized) return;
    setName(existing.name);
    setSlug(existing.slug ?? '');
    setDescription(existing.description ?? '');
    setImageUrl(existing.image_url ?? '');
    setIsActive(existing.state !== 'inactive');
    setIsFeatured(existing.is_featured ?? false);
    setInitialized(true);
  }, [existing, isEdit, initialized]);

  const mutation = useMutation({
    mutationFn: async (data: CreateCategoryDto | UpdateCategoryDto) => {
      if (isEdit && categoryId) {
        return CategoryService.update(categoryId, data as UpdateCategoryDto);
      }
      return CategoryService.create(data as CreateCategoryDto);
    },
    onSuccess: () => {
      toastSuccess(isEdit ? 'Categoría actualizada' : 'Categoría creada');
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      queryClient.invalidateQueries({ queryKey: ['categories-stats'] });
      queryClient.invalidateQueries({ queryKey: ['product-categories'] });
      if (categoryId) queryClient.invalidateQueries({ queryKey: ['category', categoryId] });
      router.back();
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || 'No se pudo guardar la categoría';
      toastError(msg);
    },
  });

  function handleSubmit() {
    if (!name.trim()) {
      toastError('El nombre es obligatorio');
      return;
    }
    const payload: CreateCategoryDto = {
      name: name.trim(),
      slug: slug.trim() || undefined,
      description: description.trim() || undefined,
      image_url: imageUrl.trim() || undefined,
      state: isActive ? 'active' : 'inactive',
      is_featured: isFeatured,
    };
    mutation.mutate(payload);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StickyHeader
        title={isEdit ? 'Editar Categoría' : 'Nueva Categoría'}
        subtitle={isEdit ? existing?.name : 'Creá una nueva categoría de producto'}
        backHref={isEdit ? `/(store-admin)/products/categories/${categoryId}` : '/(store-admin)/products/categories'}
        actions={[
          { label: 'Cancelar', variant: 'outline', onPress: () => router.back() },
          { label: isEdit ? 'Guardar' : 'Crear', variant: 'primary', loading: mutation.isPending, onPress: handleSubmit },
        ]}
      />
      <ScrollView
        contentContainerStyle={{ padding: spacing[4], gap: spacing[3], paddingBottom: spacing[8] }}
        keyboardShouldPersistTaps="handled"
      >
        {isEdit && isLoading ? null : (
          <>
            <Card>
              <Card.Body style={{ gap: spacing[3] }}>
                <Input label="Nombre *" value={name} onChangeText={setName} placeholder="Ej: Ropa, Electrónica, Servicios" maxLength={255} />
                <Input label="Slug" value={slug} onChangeText={setSlug} placeholder="se genera automáticamente si lo dejás vacío" maxLength={255} />
                <Textarea
                  label="Descripción"
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Descripción breve de la categoría (opcional)"
                  rows={3}
                  maxLength={1000}
                />
              </Card.Body>
            </Card>

            <Card>
              <Card.Header title="Imagen" />
              <Card.Body style={{ gap: spacing[3] }}>
                <Input
                  label="URL de la imagen"
                  value={imageUrl}
                  onChangeText={setImageUrl}
                  placeholder="https://..."
                  maxLength={500}
                  helperText="Pegá la URL de la imagen o subila desde la versión web."
                />
              </Card.Body>
            </Card>

            <Card>
              <Card.Header title="Visibilidad" />
              <Card.Body>
                <Toggle value={isActive} onChange={setIsActive} label="Categoría activa" description="Las categorías inactivas no aparecen en filtros ni en nuevos productos." />
                <View style={{ height: spacing[2] }} />
                <Toggle value={isFeatured} onChange={setIsFeatured} label="Categoría destacada" description="Se muestra con prioridad en la tienda online." />
              </Card.Body>
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  );
}