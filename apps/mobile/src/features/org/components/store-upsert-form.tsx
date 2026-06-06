import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { OrgStoreService } from '@/features/org/services';
import type { CreateStoreDto, UpdateStoreDto, Store } from '@/features/org/types/store.types';
import { StoreType } from '@/features/org/types/store.types';
import { Button } from '@/shared/components/button/button';
import { Card } from '@/shared/components/card/card';
import { Input } from '@/shared/components/input/input';
import { Spinner } from '@/shared/components/spinner/spinner';
import { toastError, toastSuccess } from '@/shared/components/toast/toast.store';
import { borderRadius, colorScales, colors, shadows, spacing, typography } from '@/shared/theme';

type StoreMode = 'create' | 'edit';

interface StoreFormState {
  name: string;
  store_code: string;
  slug: string;
  store_type: string;
  timezone: string;
  is_active: boolean;
  address_line1: string;
  address_line2: string;
  city: string;
  state_province: string;
  postal_code: string;
  country_code: string;
  phone_number: string;
  logo_url: string;
}

const initialForm: StoreFormState = {
  name: '',
  store_code: '',
  slug: '',
  store_type: StoreType.PHYSICAL,
  timezone: 'America/Bogota',
  is_active: true,
  address_line1: '',
  address_line2: '',
  city: '',
  state_province: '',
  postal_code: '',
  country_code: 'CO',
  phone_number: '',
  logo_url: '',
};

const STORE_TYPE_OPTIONS = [
  { value: 'physical', label: 'Física' },
  { value: 'online', label: 'Online' },
  { value: 'hybrid', label: 'Híbrida' },
  { value: 'popup', label: 'Temporal' },
  { value: 'kiosko', label: 'Kiosko' },
];

const TIMEZONE_OPTIONS = [
  { value: 'America/Bogota', label: 'Bogotá (UTC-5)' },
  { value: 'America/Medellin', label: 'Medellín (UTC-5)' },
  { value: 'America/Cali', label: 'Cali (UTC-5)' },
  { value: 'America/New_York', label: 'Nueva York (UTC-5)' },
  { value: 'America/Mexico_City', label: 'Ciudad de México (UTC-6)' },
  { value: 'Europe/Madrid', label: 'Madrid (UTC+1)' },
];

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface StoreUpsertFormProps {
  mode: StoreMode;
  storeId?: number;
}

export function StoreUpsertForm({ mode, storeId }: StoreUpsertFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<StoreFormState>(initialForm);
  const [errors, setErrors] = useState<Partial<Record<keyof StoreFormState, string>>>({});
  const [slugEdited, setSlugEdited] = useState(false);

  const isEdit = mode === 'edit';

  const { data: existingStore, isLoading: loadingStore } = useQuery({
    queryKey: ['org-store', storeId],
    queryFn: () => OrgStoreService.getById(storeId!),
    enabled: isEdit && !!storeId,
  });

  useEffect(() => {
    if (existingStore) {
      const address = (existingStore as any).primary_address || '';
      setForm({
        name: existingStore.name || '',
        store_code: existingStore.store_code || '',
        slug: existingStore.slug || '',
        store_type: existingStore.store_type || StoreType.PHYSICAL,
        timezone: 'America/Bogota',
        is_active: existingStore.is_active !== false,
        address_line1: address,
        address_line2: '',
        city: '',
        state_province: '',
        postal_code: '',
        country_code: 'CO',
        phone_number: '',
        logo_url: existingStore.logo_url || '',
      });
    }
  }, [existingStore]);

  useEffect(() => {
    if (!slugEdited && form.name && !isEdit) {
      setForm((prev) => ({ ...prev, slug: generateSlug(form.name) }));
    }
  }, [form.name, slugEdited, isEdit]);

  const updateField = <K extends keyof StoreFormState>(key: K, value: StoreFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) {
      setErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  };

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof StoreFormState, string>> = {};

    if (!form.name.trim()) {
      newErrors.name = 'El nombre es requerido';
    } else if (form.name.trim().length < 2) {
      newErrors.name = 'Mínimo 2 caracteres';
    }

    if (form.store_code && form.store_code.length > 20) {
      newErrors.store_code = 'Máximo 20 caracteres';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const createMutation = useMutation({
    mutationFn: (data: CreateStoreDto) => OrgStoreService.create(data as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-stores'] });
      queryClient.invalidateQueries({ queryKey: ['org-stores-stats'] });
      toastSuccess('Tienda creada exitosamente');
      router.back();
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || error?.message || 'Error al crear tienda';
      toastError(message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: UpdateStoreDto) => OrgStoreService.update(storeId!, data as any),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-stores'] });
      queryClient.invalidateQueries({ queryKey: ['org-stores-stats'] });
      toastSuccess('Tienda actualizada exitosamente');
      router.back();
    },
    onError: (error: any) => {
      const message = error?.response?.data?.message || error?.message || 'Error al actualizar tienda';
      toastError(message);
    },
  });

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = () => {
    if (!validate()) return;

    const commonData = {
      name: form.name.trim(),
      slug: form.slug || undefined,
      store_code: form.store_code || undefined,
      store_type: form.store_type as StoreType,
      timezone: form.timezone || undefined,
      is_active: form.is_active,
      logo_url: form.logo_url || undefined,
    };

    if (isEdit) {
      updateMutation.mutate(commonData);
    } else {
      const createData: CreateStoreDto = {
        ...commonData,
        address: form.address_line1
          ? {
              address_line1: form.address_line1,
              address_line2: form.address_line2 || undefined,
              city: form.city,
              state_province: form.state_province || undefined,
              postal_code: form.postal_code || undefined,
              country_code: form.country_code || 'CO',
              phone_number: form.phone_number || undefined,
            }
          : undefined,
      };
      createMutation.mutate(createData);
    }
  };

  if (isEdit && loadingStore) {
    return (
      <View style={styles.centerContent}>
        <Spinner />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 100 : 0}
    >
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Basic Information */}
        <Card>
          <Card.Header title="Información Básica" />
          <Card.Body>
            <View style={styles.formRow}>
              <Input
                label="Nombre de la Tienda"
                value={form.name}
                onChangeText={(v) => updateField('name', v)}
                placeholder="Tienda Central"
                error={errors.name}
              />
            </View>

            <View style={styles.formRow}>
              <Input
                label="Código"
                value={form.store_code}
                onChangeText={(v) => updateField('store_code', v)}
                placeholder="TC001"
                error={errors.store_code}
                helperText="Código único para la tienda"
              />
            </View>

            <View style={styles.formRow}>
              <Input
                label="Slug (URL)"
                value={form.slug}
                onChangeText={(v) => {
                  updateField('slug', v);
                  setSlugEdited(true);
                }}
                placeholder="tienda-central"
                helperText="Generado automáticamente desde el nombre"
              />
            </View>

            <View style={styles.formRow}>
              <Text style={styles.label}>Tipo de Tienda</Text>
              <View style={styles.chipRow}>
                {STORE_TYPE_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.value}
                    onPress={() => updateField('store_type', opt.value)}
                    style={[styles.chip, form.store_type === opt.value && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, form.store_type === opt.value && styles.chipTextActive]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.formRow}>
              <Text style={styles.label}>Zona Horaria</Text>
              <View style={styles.chipRow}>
                {TIMEZONE_OPTIONS.map((opt) => (
                  <Pressable
                    key={opt.value}
                    onPress={() => updateField('timezone', opt.value)}
                    style={[styles.chip, form.timezone === opt.value && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, form.timezone === opt.value && styles.chipTextActive]}>
                      {opt.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.toggleRow}>
              <Pressable
                onPress={() => updateField('is_active', !form.is_active)}
                style={[styles.toggle, form.is_active && styles.toggleActive]}
              >
                <View style={[styles.toggleDot, form.is_active && styles.toggleDotActive]} />
              </Pressable>
              <Text style={styles.toggleLabel}>Tienda activa</Text>
            </View>
          </Card.Body>
        </Card>

        {/* Address */}
        <Card>
          <Card.Header title="Dirección" />
          <Card.Body>
            <View style={styles.formRow}>
              <Input
                label="Dirección"
                value={form.address_line1}
                onChangeText={(v) => updateField('address_line1', v)}
                placeholder="Carrera 7 # 72-01"
              />
            </View>

            <View style={styles.formRow}>
              <Input
                label="Complemento (opcional)"
                value={form.address_line2}
                onChangeText={(v) => updateField('address_line2', v)}
                placeholder="Oficina 301, Torre A"
              />
            </View>

            <View style={styles.formRow}>
              <Input
                label="Ciudad"
                value={form.city}
                onChangeText={(v) => updateField('city', v)}
                placeholder="Bogotá"
              />
            </View>

            <View style={styles.formRow}>
              <Input
                label="Departamento / Estado"
                value={form.state_province}
                onChangeText={(v) => updateField('state_province', v)}
                placeholder="Cundinamarca"
              />
            </View>

            <View style={styles.formRow}>
              <Input
                label="Código Postal"
                value={form.postal_code}
                onChangeText={(v) => updateField('postal_code', v)}
                placeholder="110231"
              />
            </View>

            <View style={styles.formRow}>
              <Input
                label="País"
                value={form.country_code}
                onChangeText={(v) => updateField('country_code', v)}
                placeholder="CO"
              />
            </View>

            <View style={styles.formRow}>
              <Input
                label="Teléfono"
                value={form.phone_number}
                onChangeText={(v) => updateField('phone_number', v)}
                placeholder="+57 300 123 4567"
              />
            </View>
          </Card.Body>
        </Card>

        {/* Branding */}
        <Card>
          <Card.Header title="Branding" />
          <Card.Body>
            <View style={styles.formRow}>
              <Input
                label="URL del Logo"
                value={form.logo_url}
                onChangeText={(v) => updateField('logo_url', v)}
                placeholder="https://ejemplo.com/logo.png"
              />
            </View>
          </Card.Body>
        </Card>

        {/* Spacer for button */}
        <View style={{ height: spacing[20] }} />
      </ScrollView>

      {/* Fixed bottom submit button */}
      <View style={styles.footer}>
        <Button
          title={isEdit ? 'Actualizar Tienda' : 'Crear Tienda'}
          onPress={handleSubmit}
          loading={isSubmitting}
          disabled={isSubmitting}
          fullWidth
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing[4],
    paddingBottom: spacing[4],
  },
  centerContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colorScales.gray[50],
  },
  formRow: {
    marginBottom: spacing[4],
  },
  label: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    fontFamily: typography.fontFamily,
    color: colors.text.secondary,
    marginBottom: spacing[1.5],
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  chip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.background,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colorScales.gray[700],
  },
  chipTextActive: {
    color: colors.background,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  toggle: {
    width: 48,
    height: 28,
    borderRadius: 14,
    backgroundColor: colorScales.gray[300],
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  toggleActive: {
    backgroundColor: colors.primary,
  },
  toggleDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  toggleDotActive: {
    alignSelf: 'flex-end',
  },
  toggleLabel: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[800],
  },
  footer: {
    padding: spacing[4],
    paddingBottom: spacing[6],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    backgroundColor: colors.background,
  },
});
