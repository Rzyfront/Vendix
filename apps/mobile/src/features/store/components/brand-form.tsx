import { useEffect, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
}

export function BrandForm({ mode, brandId }: BrandFormProps) {
  // Safe area bottom: en dispositivos con gesture bar / home indicator,
  // el paddingBottom del ScrollView debe sumar el inset para que el último
  // campo del form no quede tapado al hacer scroll hasta el final.
  const insets = useSafeAreaInsets();
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

  // Modal flow: ImageSourceModal → ImageEditModal — mismo flujo que
  // category-form (espejo del web image picker para brands).
  const [imageSourceOpen, setImageSourceOpen] = useState(false);
  const [imageEditUri, setImageEditUri] = useState<string | null>(null);

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

  // Espejo web: usado para mostrar/ocultar el botón "Quitar" + cambiar
  // el label del CTA entre "Cambiar" (imagen existente) y "Agregar"
  // (slot vacío).
  const hasImage = logoUrl.trim().length > 0;

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
      {/* KeyboardAvoidingView envuelve el ScrollView: cuando el usuario
          toca un Input y se abre el teclado, la vista se ajusta para que
          el campo activo quede visible (iOS usa 'padding', Android ajusta
          el layout nativo via windowSoftInputMode en el manifest). */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.kav}
      >
      <ScrollView
        contentContainerStyle={{ padding: spacing[4], gap: spacing[3], paddingBottom: insets.bottom + spacing[8] }}
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
              <Card.Body style={styles.imageCardBody}>
                {/* Preview 64×64 — espejo web exacto (.rounded-lg + border-gray-100
                    + bg-white + 1px border + overflow-hidden). Si la marca no
                    tiene imagen cargada, muestra placeholder de texto. */}
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
                  <Text style={styles.imageTitle}>Logo de la marca</Text>
                  <Text style={styles.imageSubtitle}>
                    Aparece en la ficha del producto y en los filtros visuales.
                  </Text>
                </View>
                {/* Columna de acciones — outline Cambiar/Agregar + ghost Quitar
                    (Quitar sólo aparece cuando hay imagen, mismo patrón que
                    category-form). */}
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
                <Toggle value={isActive} onChange={setIsActive} label="Marca activa" description="Las marcas inactivas no aparecen en filtros ni en nuevos productos." />
                <View style={{ height: spacing[2] }} />
                <Toggle value={isFeatured} onChange={setIsFeatured} label="Marca destacada" description="Se muestra con prioridad en la tienda online." />
              </Card.Body>
            </Card>
          </>
        )}
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Modal reutilizable para tomar/elegir logo. Mismo componente
          usado en product-upsert-form y category-form. Después del picker
          se pasa por ImageEditModal (recorte/rotar) antes de guardar el
          URI final en el form. */}
      <ImageSourceModal
        visible={imageSourceOpen}
        onClose={() => setImageSourceOpen(false)}
        remainingSlots={1}
        onConfirm={(image: UploadedImage) => {
          setImageSourceOpen(false);
          setImageEditUri(image.uri);
          toastSuccess('Logo seleccionado — ajusta antes de guardar');
        }}
      />

      {/* Modal de edición/recorte tras ImageSourceModal. Al pulsar
          "Guardar ajuste" el URI se persiste en `logoUrl`. */}
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
  // KeyboardAvoidingView wrapper: full-flex para que el ScrollView ocupe
  // todo el espacio disponible debajo del StickyHeader.
  kav: { flex: 1 },
  // ── Imagen card (espejo web: row, padding-3, gap-3, bg-gray-50) ──
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
  // .image-actions: column apilada (acción primaria Cambiar arriba,
  // secundaria Quitar debajo) para jerarquía clara.
  imageActions: {
    flexDirection: 'column',
    gap: spacing[2],
    flexShrink: 0,
    alignItems: 'stretch',
  },
});