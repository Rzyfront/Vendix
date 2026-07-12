import React, { useEffect, useState } from 'react';
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
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
import { CategoryService } from '@/features/store/services/category.service';
import { toastError, toastSuccess } from '@/shared/components/toast/toast.store';
import type {
  CreateCategoryDto,
  ProductCategory,
  UpdateCategoryDto,
} from '@/features/store/types';
import {
  borderRadius,
  colors,
  colorScales,
  spacing,
} from '@/shared/theme';

interface CategoryFormProps {
  mode: 'create' | 'edit';
  categoryId?: number;
  /**
   * Si se pasa, el botón X del header llama `onClose` en lugar de
   * `router.back()`. Usado cuando el form se renderiza dentro de un
   * <Modal> (espejo del popup web 'Nueva Categoría' / 'Editar Categoría').
   * Sin `onClose`, el form se comporta como pantalla completa con back
   * navigation y botón Cancelar.
   */
  onClose?: () => void;
}

/**
 * CategoryForm — formulario Crear/Editar categoría.
 *
 * Espejo del popup web "Editar Categoría" / "Nueva Categoría"
 * (apps/frontend/.../inventory/operations/components/category-form).
 *
 * Estructura idéntica al modal web:
 *   Header (close + Crear/Guardar Cambios primario)
 *   Card Datos Básicos → Nombre * + Slug
 *   Card Imagen → preview 64×64 con imagen cargada O placeholder +
 *     botones outline "Cambiar"/"Agregar" + ghost "Quitar" (sólo cuando hay imagen)
 *   Card Descripción → textarea rows=3
 *   Toggle Categoría activa (default true)
 *   Toggle Categoría destacada (default false)
 *
 * El botón primario:
 *   - modo `create` → "Crear Categoría"
 *   - modo `edit`  → "Guardar Cambios"
 *
 * Se invoca desde:
 *   - app/(store-admin)/products/categories/create.tsx (mode="create")
 *   - app/(store-admin)/products/categories/[id].tsx  (mode="edit")
 */
export function CategoryForm({ mode, categoryId, onClose }: CategoryFormProps) {
  // Safe area bottom: en dispositivos con gesture bar / home indicator,
  // el paddingBottom del ScrollView debe sumar el inset para que el último
  // campo del form no quede tapado al hacer scroll hasta el final.
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const isEdit = mode === 'edit';

  const { data: existing, isLoading } = useQuery({
    queryKey: ['category', categoryId],
    queryFn: () => CategoryService.getById(Number(categoryId)),
    enabled: isEdit && !!categoryId,
  });

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [isFeatured, setIsFeatured] = useState(false);
  const [initialized, setInitialized] = useState(false);

  const [imageSourceOpen, setImageSourceOpen] = useState(false);
  // Modal de edición/recorte. Después de elegir imagen (subir/tomar
  // foto/URL) el usuario pasa por el editor para ajustar antes de
  // guardar. Espejo del flujo `image-source-modal → image-edit-modal`
  // del product-upsert-form.
  const [imageEditUri, setImageEditUri] = useState<string | null>(null);

  // Hidratación al editar (espejo web: existing.image_url se carga en
  // el campo `image_url`, y los toggles arrancan desde los valores del
  // backend).  Se hace en useEffect para no llamar setters durante
  // render — eso crea un infinite loop en RN runtime.
  useEffect(() => {
    if (!isEdit || !existing || initialized) return;
    setName(existing.name ?? '');
    setSlug(existing.slug ?? '');
    setDescription(existing.description ?? '');
    setImageUrl(existing.image_url ?? '');
    setIsActive(existing.state !== 'inactive');
    setIsFeatured(existing.is_featured ?? false);
    setInitialized(true);
  }, [existing, isEdit, initialized]);

  const mutation = useMutation({
    mutationFn: async (payload: CreateCategoryDto | UpdateCategoryDto) => {
      if (isEdit && categoryId) {
        return CategoryService.update(
          Number(categoryId),
          payload as UpdateCategoryDto,
        );
      }
      return CategoryService.create(payload as CreateCategoryDto);
    },
    onSuccess: () => {
      toastSuccess(isEdit ? 'Categoría actualizada' : 'Categoría creada');
      queryClient.invalidateQueries({ queryKey: ['categories'] });
      queryClient.invalidateQueries({ queryKey: ['categories-stats'] });
      queryClient.invalidateQueries({ queryKey: ['product-categories'] });
      if (categoryId) {
        queryClient.invalidateQueries({ queryKey: ['category', categoryId] });
      }
      // Modal mode (category-form-modal): cerramos el modal padre.
      // Screen mode (create.tsx/edit.tsx): volvemos a la pantalla
      // anterior en el stack de navegación.
      if (onClose) {
        onClose();
      } else {
        router.back();
      }
    },
    onError: (err: any) => {
      const data = err?.response?.data;
      const detail = Array.isArray(data?.message)
        ? data.message.join(' • ')
        : data?.message;
      toastError(
        typeof detail === 'string' ? detail : 'No se pudo guardar la categoría',
      );
    },
  });

  const handleSubmit = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toastError('El nombre es obligatorio');
      return;
    }
    const payload: CreateCategoryDto = {
      name: trimmedName,
      slug: slug.trim() || undefined,
      description: description.trim() || undefined,
      image_url: imageUrl.trim() || undefined,
      state: isActive ? 'active' : 'inactive',
      is_featured: isFeatured,
    };
    mutation.mutate(payload);
  };

  const hasImage = imageUrl.trim().length > 0;

  // Espejo web: botón primario deshabilitado si el nombre está vacío.
  const canSubmit = name.trim().length > 0;

  return (
    <View style={styles.container}>
      <StickyHeader
        title={isEdit ? 'Editar Categoría' : 'Nueva Categoría'}
        subtitle="Administra la información de la categoría"
        backHref={
          onClose
            ? undefined // modal mode: hide back, usamos botón X
            : isEdit
              ? `/(store-admin)/products/categories/${categoryId}`
              : '/(store-admin)/products/categories'
        }
        actions={[
          {
            label: '',
            icon: 'x',
            variant: 'outline',
            onPress: onClose ?? (() => router.back()),
          },
          {
            label: isEdit ? 'Guardar Cambios' : 'Crear Categoría',
            icon: 'check',
            variant: 'primary',
            loading: mutation.isPending,
            disabled: !canSubmit,
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
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing[8] }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {isEdit && isLoading ? null : (
          <>
            {/* Card de Datos Básicos — espejo web: grid Nombre + Slug.
                En el web es `grid-cols-1 md:grid-cols-2 gap-3`. En mobile
                queda stack vertical; en md+ aplica el mismo gap. */}
            <Card style={styles.card}>
              <Card.Body style={styles.cardBodyGrid}>
                <Input
                  label="Nombre *"
                  value={name}
                  onChangeText={setName}
                  placeholder="Nombre de la categoría"
                  maxLength={100}
                />
                <Input
                  label="Slug"
                  value={slug}
                  onChangeText={setSlug}
                  placeholder="nombre-categoria"
                  maxLength={120}
                  helperText="Identificador en URLs. Solo letras, números y guiones."
                />
              </Card.Body>
            </Card>

            {/* Card Imagen — espejo web exacto:
                contenedor rounded-lg + border-gray-100 + bg-gray-50 +
                padding-3, fila con preview 64×64 + textos + dos botones
                (Cambiar outline + Quitar ghost). Quitar sólo aparece
                cuando hay imagen. */}
            <Card style={styles.card}>
              <Card.Body style={styles.imageCardBody}>
                <View style={styles.imagePreview}>
                  {hasImage ? (
                    <Image
                      source={{ uri: imageUrl }}
                      style={styles.imagePreviewImg}
                      resizeMode="cover"
                    />
                  ) : (
                    <Text style={styles.imagePlaceholderText}>Imagen</Text>
                  )}
                </View>
                <View style={styles.imageTexts}>
                  <Text style={styles.imageTitle}>
                    Imagen para la tienda online
                  </Text>
                  <Text style={styles.imageSubtitle}>
                    Se usará en el inicio y en filtros visuales de categorías.
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
                        setImageUrl('');
                        toastSuccess('Imagen quitada');
                      }}
                    />
                  ) : null}
                </View>
              </Card.Body>
            </Card>

            {/* Descripción — Textarea rows=3 max 1000 (espejo web) */}
            <Card style={styles.card}>
              <Card.Body>
                <Textarea
                  label="Descripción"
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Descripción opcional..."
                  rows={3}
                  maxLength={1000}
                />
              </Card.Body>
            </Card>

            {/* Toggles Categoría activa / destacada — espejo web
                setting-toggle-row (.bg-gray-50 + border + rounded-xl + p-2) */}
            <View style={styles.settingToggleRow}>
              <View style={styles.settingToggleInfo}>
                <Text style={styles.settingToggleLabel}>Categoría activa</Text>
                <Text style={styles.settingToggleDesc}>
                  Desactiva para ocultar esta categoría del catálogo.
                </Text>
              </View>
              <Toggle value={isActive} onChange={setIsActive} />
            </View>

            <View style={styles.settingToggleRow}>
              <View style={styles.settingToggleInfo}>
                <Text style={styles.settingToggleLabel}>Categoría destacada</Text>
                <Text style={styles.settingToggleDesc}>
                  Dale prioridad en el inicio de la tienda online.
                </Text>
              </View>
              <Toggle value={isFeatured} onChange={setIsFeatured} />
            </View>
          </>
        )}
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Modal reutilizable para tomar/elegir imagen. Mismo componente
          usado en product-upsert-form; aquí sólo necesitamos el URI
          (data-url si base64 está disponible) para enviar al backend. */}
      <ImageSourceModal
        visible={imageSourceOpen}
        onClose={() => setImageSourceOpen(false)}
        remainingSlots={1}
        onConfirm={(image: UploadedImage) => {
          // Cierra el picker y abre el editor de imagen (recorte/rotar)
          // antes de guardar el URI final en el form.
          setImageSourceOpen(false);
          setImageEditUri(image.uri);
          toastSuccess('Imagen seleccionada — ajusta antes de guardar');
        }}
      />

      {/* Modal de edición/recorte que se abre tras ImageSourceModal.
          Al pulsar "Guardar ajuste" el URI (ya manipulado por el editor)
          se persiste en `imageUrl`. Al pulsar X o cerrar, simplemente
          descarta la imagen sin guardar. */}
      <ImageEditModal
        visible={imageEditUri !== null}
        imageUri={imageEditUri}
        onClose={() => setImageEditUri(null)}
        onApply={(result: ImageEditResult) => {
          setImageUrl(result.uri);
          setImageEditUri(null);
          toastSuccess('Imagen recortada y guardada');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  // KeyboardAvoidingView wrapper: full-flex para que el ScrollView ocupe
  // todo el espacio disponible debajo del StickyHeader.
  kav: { flex: 1 },
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
  cardBodyGrid: {
    gap: spacing[3],
  },
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
  // .image-actions: column (Apilado vertical). El botón "Quitar" aparece
  // debajo del "Cambiar"/"Agregar" para tener jerarquía clara: la
  // acción primaria (cambiar) arriba, la secundaria (quitar) abajo.
  imageActions: {
    flexDirection: 'column',
    gap: spacing[2],
    flexShrink: 0,
    alignItems: 'stretch',
  },

  // ── Toggle rows (espejo web .setting-toggle-row) ──
  settingToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2],
    marginTop: spacing[3],
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[100],
  },
  settingToggleInfo: { flex: 1, marginRight: spacing[3] },
  settingToggleLabel: {
    fontSize: 12,
    fontWeight: '700' as any,
    color: colorScales.gray[700],
  },
  settingToggleDesc: {
    fontSize: 10,
    color: colorScales.gray[500],
    marginTop: 2,
    lineHeight: 13,
  },
});

export default CategoryForm;
