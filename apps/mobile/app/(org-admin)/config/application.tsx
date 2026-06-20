import { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { OrgConfigService } from '@/features/org/services/org-config.service';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { Input } from '@/shared/components/input/input';
import { Button } from '@/shared/components/button/button';
import { Icon } from '@/shared/components/icon/icon';
import { toastError, toastSuccess } from '@/shared/components/toast/toast.store';
import { ApiError } from '@/core/api/errors';
import {
  BRANDING_DEFAULTS,
  isValidHex,
  mergeBrandingDefaults,
  normalizeHex,
} from '@/features/org/components/config-formatters';
import {
  colors,
  colorScales,
  spacing,
  typography,
  borderRadius,
} from '@/shared/theme';
import type { OrganizationBranding } from '@/core/models/org-admin/config.types';

/**
 * Configuración · General (Aplicación).
 * Paridad visual con `apps/frontend/.../config/application/`.
 *
 * Campos editables:
 *  - name (nombre visible de la organización)
 *  - primary_color, secondary_color, accent_color
 *
 * Logo / favicon: omitidos en mobile v1 (la subida se mantiene en web).
 */
export default function ConfigApplicationScreen() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [form, setForm] = useState<OrganizationBranding>(BRANDING_DEFAULTS);
  const [errors, setErrors] = useState<{ name?: string; primary_color?: string; secondary_color?: string; accent_color?: string }>({});

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-config-branding'],
    queryFn: () => OrgConfigService.getFullSettings(),
    staleTime: 60_000,
  });

  // Cargar valores iniciales cuando llega el response
  useEffect(() => {
    const merged = mergeBrandingDefaults(data?.branding);
    setForm(merged);
    setErrors({});
  }, [data]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const dirty = useMemo(() => {
    const original = mergeBrandingDefaults(data?.branding);
    return (
      form.name !== original.name ||
      form.primary_color !== original.primary_color ||
      form.secondary_color !== original.secondary_color ||
      form.accent_color !== original.accent_color
    );
  }, [form, data]);

  const validate = (): boolean => {
    const next: typeof errors = {};
    if (!form.name.trim()) next.name = 'El nombre es obligatorio';
    if (!isValidHex(form.primary_color)) next.primary_color = 'Color hexadecimal inválido';
    if (!isValidHex(form.secondary_color)) next.secondary_color = 'Color hexadecimal inválido';
    if (!isValidHex(form.accent_color)) next.accent_color = 'Color hexadecimal inválido';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const saveMutation = useMutation({
    mutationFn: (branding: OrganizationBranding) => OrgConfigService.saveBranding(branding),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-config-branding'] });
      toastSuccess('Configuración guardada');
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : 'No se pudo guardar la configuración';
      toastError(msg);
    },
  });

  const onSave = () => {
    if (!validate()) return;
    saveMutation.mutate({
      ...form,
      name: form.name.trim(),
      primary_color: normalizeHex(form.primary_color),
      secondary_color: normalizeHex(form.secondary_color),
      accent_color: normalizeHex(form.accent_color),
    });
  };

  const onDiscard = () => {
    setForm(mergeBrandingDefaults(data?.branding));
    setErrors({});
  };

  if (isLoading && !data) {
    return (
      <OrgPageContainer loading>
        {null}
      </OrgPageContainer>
    );
  }

  return (
    <OrgPageContainer refreshing={refreshing} onRefresh={onRefresh} padding={false}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* Hero */}
        <View style={styles.heroCard}>
          <View style={styles.heroIcon}>
            <Icon name="palette" size={22} color={colors.primary} />
          </View>
          <View style={styles.heroBody}>
            <Text style={styles.heroTitle}>General</Text>
            <Text style={styles.heroSubtitle}>
              Personaliza el nombre visible y la paleta principal de tu organización.
            </Text>
          </View>
        </View>

        {/* Preview card */}
        <View style={styles.previewCard}>
          <Text style={styles.previewLabel}>Vista previa</Text>
          <View
            style={[
              styles.previewSurface,
              { backgroundColor: normalizeHex(form.primary_color) || BRANDING_DEFAULTS.primary_color },
            ]}
          >
            <Text style={[styles.previewName, { color: '#ffffff' }]} numberOfLines={1}>
              {form.name.trim() || BRANDING_DEFAULTS.name}
            </Text>
            <View style={styles.previewChipsRow}>
              <View
                style={[
                  styles.previewChip,
                  { backgroundColor: normalizeHex(form.secondary_color) || BRANDING_DEFAULTS.secondary_color },
                ]}
              />
              <View
                style={[
                  styles.previewChip,
                  { backgroundColor: normalizeHex(form.accent_color) || BRANDING_DEFAULTS.accent_color },
                ]}
              />
            </View>
          </View>
        </View>

        {/* Form */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Identidad</Text>

          <View style={styles.field}>
            <Input
              label="Nombre de la organización"
              value={form.name}
              onChangeText={(t) => setForm((prev) => ({ ...prev, name: t }))}
              placeholder="Mi organización"
              error={errors.name}
              autoCapitalize="words"
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Colores principales</Text>

          <View style={styles.field}>
            <ColorField
              label="Color primario"
              value={form.primary_color}
              onChange={(v) => setForm((prev) => ({ ...prev, primary_color: v }))}
              error={errors.primary_color}
            />
          </View>

          <View style={styles.field}>
            <ColorField
              label="Color secundario"
              value={form.secondary_color}
              onChange={(v) => setForm((prev) => ({ ...prev, secondary_color: v }))}
              error={errors.secondary_color}
            />
          </View>

          <View style={styles.field}>
            <ColorField
              label="Color de acento"
              value={form.accent_color}
              onChange={(v) => setForm((prev) => ({ ...prev, accent_color: v }))}
              error={errors.accent_color}
            />
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <Button
            title="Guardar"
            onPress={onSave}
            loading={saveMutation.isPending}
            disabled={!dirty || saveMutation.isPending}
            fullWidth
          />
          <View style={{ height: spacing[2] }} />
          <Button
            title="Descartar cambios"
            onPress={onDiscard}
            variant="outline"
            disabled={!dirty || saveMutation.isPending}
            fullWidth
          />
        </View>

        {/* Pending indicator */}
        {saveMutation.isPending ? (
          <View style={styles.pendingHint}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.pendingText}>Guardando cambios…</Text>
          </View>
        ) : null}

        <View style={styles.footerNote}>
          <Icon name="info" size={14} color={colorScales.gray[500]} />
          <Text style={styles.footerNoteText}>
            El logo y favicon se administran desde el panel web.
          </Text>
        </View>

        <View style={{ height: spacing[12] }} />
      </ScrollView>
    </OrgPageContainer>
  );
}

// ----------------------------------------------------------------------------
// Color field (text input + swatch)
// ----------------------------------------------------------------------------

interface ColorFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
}

function ColorField({ label, value, onChange, error }: ColorFieldProps) {
  const valid = isValidHex(value);
  const swatch = valid ? normalizeHex(value) : colorScales.gray[300];
  return (
    <View style={colorStyles.wrap}>
      <View style={colorStyles.row}>
        <View style={[colorStyles.swatch, { backgroundColor: swatch }]}>
          {!valid ? (
            <Icon name="alert-triangle" size={14} color={colorScales.amber[700]} />
          ) : null}
        </View>
        <View style={colorStyles.inputCol}>
          <Input
            label={label}
            value={value}
            onChangeText={onChange}
            placeholder="#2ecc71"
            autoCapitalize="none"
            autoCorrect={false}
            error={error}
          />
        </View>
      </View>
    </View>
  );
}

const colorStyles = StyleSheet.create({
  wrap: {
    width: '100%',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
  },
  swatch: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    marginTop: 24, // align with input box (label offset)
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputCol: {
    flex: 1,
  },
});

// ----------------------------------------------------------------------------
// Styles
// ----------------------------------------------------------------------------

const styles = StyleSheet.create({
  scrollContent: {
    padding: spacing[4],
  },

  heroCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
    padding: spacing[4],
    marginBottom: spacing[4],
    borderWidth: 1,
    borderColor: colorScales.gray[100],
  },
  heroIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    backgroundColor: colorScales.green[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBody: {
    flex: 1,
  },
  heroTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
    marginBottom: 2,
  },
  heroSubtitle: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[600],
    lineHeight: typography.lineHeight.normal * typography.fontSize.sm,
  },

  previewCard: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    padding: spacing[4],
    marginBottom: spacing[4],
  },
  previewLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: spacing[2],
  },
  previewSurface: {
    borderRadius: borderRadius.md,
    padding: spacing[4],
    minHeight: 96,
    justifyContent: 'space-between',
  },
  previewName: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
  },
  previewChipsRow: {
    flexDirection: 'row',
    gap: spacing[2],
    marginTop: spacing[3],
  },
  previewChip: {
    width: 36,
    height: 24,
    borderRadius: borderRadius.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },

  section: {
    marginBottom: spacing[5],
  },
  sectionTitle: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: spacing[3],
  },
  field: {
    marginBottom: spacing[3],
  },

  actions: {
    marginTop: spacing[2],
    marginBottom: spacing[4],
  },
  pendingHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  pendingText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[600],
  },

  footerNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[2],
    marginTop: spacing[2],
  },
  footerNoteText: {
    flex: 1,
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    lineHeight: typography.lineHeight.normal * typography.fontSize.xs,
  },
});
