import { useEffect, useState } from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  Input,
  StickyHeader,
  Textarea,
  Toggle,
} from '@/shared/components';
import { Icon } from '@/shared/components/icon/icon';
import { LightboxImageTap } from '@/features/store/components/image-lightbox';
import {
  ImageSourceModal,
  type UploadedImage,
} from '@/features/store/components/image-source-modal';
import {
  ImageEditModal,
  type ImageEditResult,
} from '@/features/store/components/image-edit-modal';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { BrandService } from '@/features/store/services/brand.service';
import type { Brand, CreateBrandDto, UpdateBrandDto } from '@/features/store/types';
import {
  borderRadius,
  colors,
  colorScales,
  spacing,
} from '@/shared/theme';

interface BrandFormProps {
  mode: 'create' | 'edit';
  brandId?: number;
  /**
   * Si se pasa, el botón X del header llama `onClose` en lugar de
   * `router.back()`. Usado cuando el form se renderiza dentro de un
   * <Modal> (espejo del popup web 'Nueva Marca' / 'Editar Marca').
   */
  onClose?: () => void;
}

export function BrandForm({ mode, brandId, onClose }: BrandFormProps) {
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

  const [imageSourceOpen, setImageSourceOpen] = useState(false);
  const [imageEditUri, setImageEditUri] = useState<string | null>(null);

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
      toastSuccess(isEdit ? 'Marca actualizada exitosamente' : 'Marca creada exitosamente');
      queryClient.invalidateQueries({ queryKey: ['brands'] });
      queryClient.invalidateQueries({ queryKey: ['brands-stats'] });
      queryClient.invalidateQueries({ queryKey: ['product-brands'] });
      if (brandId) queryClient.invalidateQueries({ queryKey: ['brand', brandId] });
      if (onClose) {
        onClose();
      } else {
        router.back();
      }
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

  const hasImage = logoUrl.trim().length > 0;

  return (
    <View style={styles.container}>
      <StickyHeader
        title={isEdit ? 'Editar Marca' : 'Nueva Marca'}
        subtitle={isEdit ? existing?.name : 'Creá una nueva marca de producto'}
        backHref={
          onClose
            ? undefined
            : isEdit
              ? `/(store-admin)/products/brands/${brandId}`
              : '/(store-admin)/products/brands'
        }
        actions={[
          {
            label: '',
            icon: 'x',
            variant: 'outline',
            onPress: onClose ?? (() => router.back()),
          },
          {
            label: isEdit ? 'Guardar Cambios' : 'Crear Marca',
            icon: 'check',
            variant: 'primary',
            loading: mutation.isPending,
            onPress: handleSubmit,
          },
        ]}
      />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
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

            <Card style={styles.card}>
              <Card.Body style={styles.imageCardBody}>
                <View style={styles.imagePreview}>
                  {hasImage ? (
                    <Image
                      source={{ uri: logoUrl }}
                      style={styles.imagePreviewImg}
                      resizeMode="cover"
                    />
                  ) : (
                    <Text style={styles.imagePlaceholderText}>Logo</Text>
                  )}
                </View>
                <View style={styles.imageTexts}>
                  <Text style={styles.imageTitle}>
                    Logo de la marca
                  </Text>
                  <Text style={styles.imageSubtitle}>
                    Se usará en el inicio y en los filtros visuales de marcas.
                  </Text>
                </View>
                <View style={styles.imageActions}>
                  <Button
                    title={hasImage ? 'Cambiar' : 'Agregar'}
                    variant="outline"
                    size="sm"
                    leftIcon={
                      <Icon name="image" size={14} color={colors.primary} />
                    }
                    onPress={() => setImageSourceOpen(true)}
                  />
                  {hasImage ? (
                    <Button
                      title="Quitar"
                      variant="ghost"
                      size="sm"
                      onPress={() => {
                        setLogoUrl('');
                        toastSuccess('Logo quitado');
                      }}
                    />
                  ) : null}
                </View>
              </Card.Body>
            </Card>

            <Card>
              <Card.Header title="Visibilidad" />
              <Card.Body>
                <Toggle
                  value={isActive}
                  onChange={setIsActive}
                  label="Marca activa"
                  description="Las marcas inactivas no aparecen en filtros ni en nuevos productos."
                />
                <View style={{ height: spacing[2] }} />
                <Toggle
                  value={isFeatured}
                  onChange={setIsFeatured}
                  label="Marca destacada"
                  description="Se muestra con prioridad en la tienda online."
                />
              </Card.Body>
            </Card>
          </>
        )}
      </ScrollView>

      <ImageSourceModal
        visible={imageSourceOpen}
        onClose={() => setImageSourceOpen(false)}
        remainingSlots={1}
        onConfirm={(image: UploadedImage) => {
          setImageSourceOpen(false);
          setImageEditUri(image.uri);
          toastSuccess('Imagen seleccionada — ajusta antes de guardar');
        }}
      />

      <ImageEditModal
        visible={imageEditUri !== null}
        imageUri={imageEditUri}
        onClose={() => setImageEditUri(null)}
        onApply={(result: ImageEditResult) => {
          setLogoUrl(result.uri);
          setImageEditUri(null);
          toastSuccess('Logo recortado y guardado');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: {
    padding: spacing[4],
    gap: spacing[3],
    paddingBottom: spacing[8],
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
  },
  imageCardBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
  },
  imagePreview: {
    width: 64,
    height: 64,
    flexShrink: 0,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imagePreviewImg: { width: '100%', height: '100%' },
  imagePlaceholderText: {
    fontSize: 11,
    color: colorScales.gray[500],
  },
  imageTexts: { flex: 1, minWidth: 0 },
  imageTitle: {
    fontSize: 13,
    fontWeight: '600' as any,
    color: colors.text.primary,
  },
  imageSubtitle: {
    fontSize: 11,
    color: colorScales.gray[500],
    marginTop: 2,
    lineHeight: 14,
  },
  imageActions: {
    flexDirection: 'column',
    gap: spacing[2],
    flexShrink: 0,
    alignItems: 'stretch',
  },
});
