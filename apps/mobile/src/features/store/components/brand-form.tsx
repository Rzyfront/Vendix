import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Input, Textarea, Toggle, Card, StickyHeader } from '@/shared/components';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { BrandService } from '@/features/store/services/brand.service';
import type { Brand, CreateBrandDto, UpdateBrandDto } from '@/features/store/types';
import { colors, spacing } from '@/shared/theme';

interface BrandFormProps {
  mode: 'create' | 'edit';
  brandId?: number;
}

export function BrandForm({ mode, brandId }: BrandFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEdit = mode === 'edit';

  const { data: existing, isLoading } = useQuery({
    queryKey: ['brand', brandId],
    queryFn: () => BrandService.getById(brandId!),
    enabled: isEdit && !!brandId,
  });

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [isFeatured, setIsFeatured] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Hydrate form when loading existing brand. Done in useEffect to avoid
  // calling state setters during render — that triggers an infinite
  // re-render loop that kills the React Native runtime on the device.
  useEffect(() => {
    if (!isEdit || !existing || initialized) return;
    setName(existing.name);
    setSlug(existing.slug ?? '');
    setDescription(existing.description ?? '');
    setLogoUrl(existing.logo_url ?? '');
    setIsActive(existing.state !== 'inactive');
    setIsFeatured(existing.is_featured ?? false);
    setInitialized(true);
  }, [existing, isEdit, initialized]);

  const mutation = useMutation({
    mutationFn: async (data: CreateBrandDto | UpdateBrandDto) => {
      if (isEdit && brandId) {
        return BrandService.update(brandId, data as UpdateBrandDto);
      }
      return BrandService.create(data as CreateBrandDto);
    },
    onSuccess: () => {
      toastSuccess(isEdit ? 'Marca actualizada' : 'Marca creada');
      queryClient.invalidateQueries({ queryKey: ['brands'] });
      queryClient.invalidateQueries({ queryKey: ['brands-stats'] });
      queryClient.invalidateQueries({ queryKey: ['product-brands'] });
      if (brandId) queryClient.invalidateQueries({ queryKey: ['brand', brandId] });
      router.back();
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || 'No se pudo guardar la marca';
      toastError(msg);
    },
  });

  function handleSubmit() {
    if (!name.trim()) {
      toastError('El nombre es obligatorio');
      return;
    }
    const payload: CreateBrandDto = {
      name: name.trim(),
      slug: slug.trim() || undefined,
      description: description.trim() || undefined,
      logo_url: logoUrl.trim() || undefined,
      state: isActive ? 'active' : 'inactive',
      is_featured: isFeatured,
    };
    mutation.mutate(payload);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StickyHeader
        title={isEdit ? 'Editar Marca' : 'Nueva Marca'}
        subtitle={isEdit ? existing?.name : 'Creá una nueva marca de producto'}
        backHref={isEdit ? `/(store-admin)/products/brands/${brandId}` : '/(store-admin)/products/brands'}
        actions={[
          {
            label: 'Cancelar',
            variant: 'outline',
            onPress: () => router.back(),
          },
          {
            label: isEdit ? 'Guardar' : 'Crear',
            variant: 'primary',
            loading: mutation.isPending,
            onPress: handleSubmit,
          },
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
                <Input
                  label="Nombre *"
                  value={name}
                  onChangeText={setName}
                  placeholder="Ej: Nike, Adidas, Samsung"
                  maxLength={100}
                />
                <Input
                  label="Slug"
                  value={slug}
                  onChangeText={setSlug}
                  placeholder="se genera automáticamente si lo dejás vacío"
                  maxLength={120}
                  helperText="Identificador en URLs. Solo letras, números y guiones."
                />
                <Textarea
                  label="Descripción"
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Descripción breve de la marca (opcional)"
                  rows={3}
                  maxLength={1000}
                />
              </Card.Body>
            </Card>

            <Card>
              <Card.Header title="Imagen" />
              <Card.Body style={{ gap: spacing[3] }}>
                <Input
                  label="URL del logo"
                  value={logoUrl}
                  onChangeText={setLogoUrl}
                  placeholder="https://..."
                  maxLength={500}
                  helperText="Pegá la URL del logo o subilo desde la versión web."
                />
              </Card.Body>
            </Card>

            <Card>
              <Card.Header title="Visibilidad" />
              <Card.Body>
                <Toggle value={isActive} onChange={setIsActive} label="Marca activa" description="Las marcas inactivas no aparecen en filtros ni en nuevos productos." />
                <View style={{ height: spacing[2] }} />
                <Toggle value={isFeatured} onChange={setIsFeatured} label="Marca destacada" description="Se muestra con prioridad en la tienda online." />
              </Card.Body>
            </Card>
          </>
        )}
      </ScrollView>
    </View>
  );
}