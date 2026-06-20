import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  RefreshControl,
  Image,
  type LayoutChangeEvent,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { OrgConfigService } from '@/features/org/services/org-config.service';
import { OrgPageContainer } from '@/shared/components/org-page-container';
import { Input } from '@/shared/components/input/input';
import { Button } from '@/shared/components/button/button';
import { Icon } from '@/shared/components/icon/icon';
import { ScrollableTabs } from '@/shared/components/scrollable-tabs';
import { OrgBadge } from '@/shared/components/org-badge';
import { toastError, toastSuccess } from '@/shared/components/toast/toast.store';
import { useAuthStore } from '@/core/store/auth.store';
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
 * Configuración · General (Aplicación) — paridad visual 1:1 con web.
 *
 * Espejo de `apps/frontend/.../config/application/application.component.ts`.
 *
 * Estructura:
 *   1. Sticky sub-header — título, subtítulo, badge Pendiente/Sincronizado,
 *      acciones Descartar/Guardar, metadata "Último guardado".
 *   2. Scrollable tabs — Vista / Identidad / Colores.
 *   3. Sección Vista previa — brand-preview card (sidebar + body) + brand-summary.
 *   4. Sección Identidad — name + asset-cards logo/favicon (display-only).
 *   5. Sección Colores — 3 color fields con swatch + hex input.
 */
type SectionId = 'preview' | 'identity' | 'colors';

const SECTIONS: { id: SectionId; label: string; icon: string }[] = [
  { id: 'preview', label: 'Vista', icon: 'app-window' },
  { id: 'identity', label: 'Identidad', icon: 'building-2' },
  { id: 'colors', label: 'Colores', icon: 'palette' },
];

export default function ConfigApplicationScreen() {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [activeSection, setActiveSection] = useState<SectionId>('preview');
  const [form, setForm] = useState<OrganizationBranding>(BRANDING_DEFAULTS);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [errors, setErrors] = useState<{
    name?: string;
    primary_color?: string;
    secondary_color?: string;
    accent_color?: string;
  }>({});

  const sectionRefs = useRef<Record<SectionId, View | null>>({
    preview: null,
    identity: null,
    colors: null,
  });
  const scrollYRef = useRef<ScrollView>(null);

  // ── Data ─────────────────────────────────────────────────────────────────
  const user = useAuthStore((s) => s.user);
  const organization = (user?.organizations || user?.store?.organizations || null) as
    | (NonNullable<typeof user>['organizations'] & {
        account_type?: string | null;
        logo_url?: string | null;
      })
    | null;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['org-config-application'],
    queryFn: () => OrgConfigService.getFullSettings(),
    staleTime: 60_000,
  });

  useEffect(() => {
    setForm(mergeBrandingDefaults(data?.branding));
    setErrors({});
  }, [data]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  // ── Derived state ────────────────────────────────────────────────────────
  const original = useMemo(() => mergeBrandingDefaults(data?.branding), [data]);
  const dirty = useMemo(
    () =>
      form.name !== original.name ||
      form.primary_color !== original.primary_color ||
      form.secondary_color !== original.secondary_color ||
      form.accent_color !== original.accent_color,
    [form, original],
  );

  // Preview es lo que se muestra en brand-preview (form || original || defaults)
  const preview: OrganizationBranding = useMemo(
    () => ({
      ...original,
      ...form,
    }),
    [form, original],
  );

  // ── Save / Discard ───────────────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: (branding: OrganizationBranding) => OrgConfigService.saveBranding(branding),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['org-config-application'] });
      setLastSaved(new Date());
      toastSuccess('Configuración guardada correctamente.');
    },
    onError: (err) => {
      toastError(err instanceof ApiError ? err.message : 'No se pudo guardar la configuración');
    },
  });

  const validate = (): boolean => {
    const next: typeof errors = {};
    if (!form.name.trim()) next.name = 'El nombre es obligatorio';
    if (!isValidHex(form.primary_color)) next.primary_color = 'Color hexadecimal inválido';
    if (!isValidHex(form.secondary_color)) next.secondary_color = 'Color hexadecimal inválido';
    if (!isValidHex(form.accent_color)) next.accent_color = 'Color hexadecimal inválido';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

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
    setForm(original);
    setErrors({});
    toastSuccess('Cambios descartados.');
  };

  // ── Tab scroll-to-section ────────────────────────────────────────────────
  const scrollToSection = useCallback((id: string) => {
    setActiveSection(id as SectionId);
    const ref = sectionRefs.current[id as SectionId];
    if (!ref) return;
    setTimeout(() => {
      ref.measureInWindow((x, y) => {
        // Scroll to position - 88px (web scroll-margin-top equivalente).
        scrollYRef.current?.scrollTo({ y: Math.max(0, y - 88), animated: true });
      });
    }, 50);
  }, []);

  // ── Organization labels ───────────────────────────────────────────────────
  const accountTypeLabel = (() => {
    const t = organization?.account_type;
    if (t === 'SINGLE_STORE') return 'Tienda única';
    if (t === 'MULTI_STORE_ORG') return 'Multi-tienda';
    return 'No definido';
  })();

  const operatingScopeLabel = (() => {
    const s = organization?.operating_scope;
    if (s === 'STORE') return 'Por tienda';
    if (s === 'ORGANIZATION') return 'Organización';
    return 'No definido';
  })();

  const organizationSlug = organization?.slug || 'No definido';
  const organizationName = form.name.trim() || organization?.name || 'Organización';
  const logoUrl = (form as any).logo_url || organization?.logo_url || null;
  const faviconUrl = ((form as any).favicon_url as string | undefined) || null;

  if (isLoading && !data) {
    return <OrgPageContainer loading>{null}</OrgPageContainer>;
  }

  return (
    <OrgPageContainer refreshing={refreshing} onRefresh={onRefresh} padding={false}>
      <View style={styles.stickySubHeader}>
        <View style={styles.subHeaderRow}>
          <Pressable
            onPress={() => {
              // No back button in mobile AdminShell; sin router.back() para evitar loops.
              // Mantener el pressable para paridad visual pero sin acción destructiva.
            }}
            hitSlop={8}
            style={styles.backBtn}
            accessibilityLabel="Volver"
          >
            <Icon name="chevron-left" size={18} color={colorScales.gray[500]} />
          </Pressable>

          <View style={styles.subHeaderText}>
            <Text style={styles.subHeaderTitle} numberOfLines={1}>
              Configuración de la aplicación
            </Text>
            <Text style={styles.subHeaderSubtitle} numberOfLines={1}>
              Identidad visual de la organización
            </Text>
          </View>

          <OrgBadge
            label={dirty ? 'Pendiente' : 'Sincronizado'}
            variant={dirty ? 'warning' : 'success'}
            style={dirty ? styles.badgePulse : undefined}
          />
        </View>

        {/* Metadata */}
        {lastSaved ? (
          <Text style={styles.metadata}>
            Último guardado: {formatSavedTime(lastSaved)}
          </Text>
        ) : null}

        {/* Actions row */}
        <View style={styles.subHeaderActions}>
          <Button
            title="Descartar"
            variant="outline"
            size="sm"
            leftIcon={<Icon name="rotate-ccw" size={14} color={colorScales.red[600]} />}
            onPress={onDiscard}
            disabled={!dirty || saveMutation.isPending}
            style={{ flex: 1, borderColor: colorScales.red[300] }}
          />
          <View style={{ width: spacing[2] }} />
          <Button
            title="Guardar"
            variant="primary"
            size="sm"
            leftIcon={<Icon name="save" size={14} color="#ffffff" />}
            onPress={onSave}
            loading={saveMutation.isPending}
            disabled={!dirty}
            style={{ flex: 1 }}
          />
        </View>
      </View>

      {/* Scrollable tabs — sticky sub-bar */}
      <View style={styles.tabsBar}>
        <ScrollableTabs
          tabs={SECTIONS}
          activeTab={activeSection}
          onTabChange={(id) => scrollToSection(id)}
        />
      </View>

      <ScrollView
        ref={scrollYRef}
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
        {/* ═══════════════════════════════════════════════════════════════════
            Vista previa
           ═══════════════════════════════════════════════════════════════════ */}
        <SectionContainer
          sectionId="preview"
          registerRef={(node) => (sectionRefs.current.preview = node)}
        >
          <SectionHeader
            icon="app-window"
            iconVariant="primary"
            title="Vista previa"
            description="Identidad visual y datos actuales de la organización."
          />

          <View style={styles.sectionBody}>
            <View style={styles.previewGrid}>
              {/* Brand preview card — left bar + body */}
              <BrandPreviewCard
                preview={preview}
                organizationName={organizationName}
                logoUrl={logoUrl}
              />

              {/* Brand summary */}
              <View style={styles.brandSummary}>
                <BrandSummaryItem label="Tipo de cuenta" value={accountTypeLabel} />
                <BrandSummaryItem label="Alcance operativo" value={operatingScopeLabel} />
                <BrandSummaryItem label="Slug" value={organizationSlug} />
              </View>
            </View>
          </View>
        </SectionContainer>

        {/* ═══════════════════════════════════════════════════════════════════
            Identidad
           ═══════════════════════════════════════════════════════════════════ */}
        <SectionContainer
          sectionId="identity"
          registerRef={(node) => (sectionRefs.current.identity = node)}
        >
          <SectionHeader
            icon="building-2"
            iconVariant="blue"
            title="Identidad"
            description="Campos reales de la sección branding."
          />

          <View style={styles.sectionBody}>
            <Input
              label="Nombre"
              value={form.name}
              onChangeText={(t) => setForm((prev) => ({ ...prev, name: t }))}
              placeholder="Nombre de la organización"
              autoCapitalize="words"
              error={errors.name}
              helperText={!errors.name ? 'Nombre visible en todo el panel.' : undefined}
            />

            <View style={{ height: spacing[4] }} />

            <AssetCard
              label="Logo"
              description="PNG o JPG. Máx 2MB."
              previewNode={
                logoUrl ? (
                  <Image source={{ uri: logoUrl }} style={styles.assetPreviewImage} resizeMode="contain" />
                ) : (
                  <Icon name="image" size={22} color={colorScales.gray[400]} />
                )
              }
              actionLabel={logoUrl ? 'Cambiar' : 'Subir'}
              variant="logo"
            />

            <View style={{ height: spacing[3] }} />

            <AssetCard
              label="Favicon"
              description="PNG, JPG o ICO. Máx 1MB."
              previewNode={
                faviconUrl ? (
                  <Image source={{ uri: faviconUrl }} style={styles.assetPreviewImage} resizeMode="contain" />
                ) : (
                  <Icon name="feather" size={22} color={colorScales.gray[400]} />
                )
              }
              actionLabel={faviconUrl ? 'Cambiar' : 'Subir'}
              variant="favicon"
            />
          </View>
        </SectionContainer>

        {/* ═══════════════════════════════════════════════════════════════════
            Colores
           ═══════════════════════════════════════════════════════════════════ */}
        <SectionContainer
          sectionId="colors"
          registerRef={(node) => (sectionRefs.current.colors = node)}
        >
          <SectionHeader
            icon="palette"
            iconVariant="pink"
            title="Colores"
            description="Paleta persistida en la configuración de marca."
          />

          <View style={styles.sectionBody}>
            <ColorField
              label="Primario"
              value={form.primary_color}
              onChange={(v) => setForm((prev) => ({ ...prev, primary_color: v }))}
              error={errors.primary_color}
            />
            <ColorField
              label="Secundario"
              value={form.secondary_color}
              onChange={(v) => setForm((prev) => ({ ...prev, secondary_color: v }))}
              error={errors.secondary_color}
            />
            <ColorField
              label="Acento"
              value={form.accent_color}
              onChange={(v) => setForm((prev) => ({ ...prev, accent_color: v }))}
              error={errors.accent_color}
            />
          </View>
        </SectionContainer>

        <View style={{ height: spacing[12] }} />
      </ScrollView>
    </OrgPageContainer>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function SectionContainer({
  sectionId,
  registerRef,
  children,
}: {
  sectionId: SectionId;
  registerRef: (n: View | null) => void;
  children: React.ReactNode;
}) {
  const onLayout = (_e: LayoutChangeEvent) => {
    // No-op: section refs are registered via the View ref callback.
  };
  return (
    <View
      ref={(n) => registerRef(n)}
      onLayout={onLayout}
      style={styles.section}
      nativeID={`section-${sectionId}`}
    >
      {children}
    </View>
  );
}

function SectionHeader({
  icon,
  iconVariant,
  title,
  description,
}: {
  icon: string;
  iconVariant: 'primary' | 'blue' | 'pink';
  title: string;
  description: string;
}) {
  const variantStyle = ICON_VARIANT_STYLES[iconVariant];
  return (
    <View style={styles.sectionHeader}>
      <View style={[styles.sectionIcon, variantStyle.wrap]}>
        <Icon name={icon} size={18} color={variantStyle.iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionDescription}>{description}</Text>
      </View>
    </View>
  );
}

const ICON_VARIANT_STYLES = {
  primary: { iconColor: colors.primary, wrap: { backgroundColor: colorScales.green[100] } },
  blue: { iconColor: '#2563eb', wrap: { backgroundColor: '#eff6ff' } },
  pink: { iconColor: '#db2777', wrap: { backgroundColor: '#fdf2f8' } },
};

// ----------------------------------------------------------------------------
// Brand preview card — espejo de .brand-preview web
// ----------------------------------------------------------------------------

function BrandPreviewCard({
  preview,
  organizationName,
  logoUrl,
}: {
  preview: OrganizationBranding;
  organizationName: string;
  logoUrl: string | null;
}) {
  const primary = normalizeHex(preview.primary_color) || BRANDING_DEFAULTS.primary_color;
  const secondary = normalizeHex(preview.secondary_color) || BRANDING_DEFAULTS.secondary_color;
  const accent = normalizeHex(preview.accent_color) || BRANDING_DEFAULTS.accent_color;
  const background = normalizeHex(preview.background_color) || '#ffffff';
  const surface = normalizeHex(preview.surface_color) || '#f9fafb';
  const textSecondary = normalizeHex(preview.text_secondary_color) || '#6b7280';

  return (
    <View style={[styles.brandPreview, { backgroundColor: background, borderColor: primary + '52' }]}>
      {/* Sidebar bar */}
      <View style={[styles.brandBar, { backgroundColor: primary }]}>
        <View style={[styles.brandMark, { backgroundColor: accent }]}>
          {logoUrl ? (
            <Image source={{ uri: logoUrl }} style={styles.brandMarkImage} resizeMode="cover" />
          ) : (
            <Icon name="building-2" size={18} color={primary} />
          )}
        </View>
        <View style={[styles.brandNav, { backgroundColor: '#ffffffd1' }]} />
        <View style={[styles.brandNav, { width: 28, backgroundColor: secondary + 'b8' }]} />
        <View style={[styles.brandNav, { width: 28, backgroundColor: accent }]} />
      </View>

      {/* Body */}
      <View style={styles.brandBody}>
        <View style={styles.brandHeader}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.brandHeaderTag, { color: textSecondary }]} numberOfLines={1}>
              ORG_ADMIN
            </Text>
            <Text style={[styles.brandHeaderName, { color: '#111827' }]} numberOfLines={1}>
              {organizationName}
            </Text>
          </View>
          <View
            style={[
              styles.brandPill,
              { borderColor: primary + '47', backgroundColor: primary + '1a' },
            ]}
          >
            <Text style={[styles.brandPillText, { color: secondary }]}>Branding</Text>
          </View>
        </View>

        <View style={[styles.brandPanel, { backgroundColor: surface, borderColor: secondary + '38', shadowColor: accent }]}>
          <View style={[styles.brandPanelBar, { backgroundColor: secondary }]} />
          <Text style={styles.brandPanelStrong}>Panel administrativo</Text>
          <Text style={[styles.brandPanelSmall, { color: textSecondary }]}>
            Primario · Secundario · Acento
          </Text>
        </View>
      </View>
    </View>
  );
}

// ----------------------------------------------------------------------------
// Brand summary item
// ----------------------------------------------------------------------------

function BrandSummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.brandSummaryItem}>
      <Text style={styles.brandSummaryLabel}>{label}</Text>
      <Text style={styles.brandSummaryValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

// ----------------------------------------------------------------------------
// Asset card — logo / favicon
// ----------------------------------------------------------------------------

function AssetCard({
  label,
  description,
  previewNode,
  actionLabel,
  variant,
}: {
  label: string;
  description: string;
  previewNode: React.ReactNode;
  actionLabel: string;
  variant: 'logo' | 'favicon';
}) {
  return (
    <View style={styles.assetCard}>
      <View style={[styles.assetPreview, variant === 'favicon' && styles.assetPreviewFavicon]}>
        {previewNode}
      </View>
      <View style={styles.assetContent}>
        <View>
          <Text style={styles.assetLabel}>{label}</Text>
          <Text style={styles.assetDescription}>{description}</Text>
        </View>
        <View style={styles.assetActions}>
          <Button
            title={actionLabel}
            variant="outline"
            size="sm"
            leftIcon={<Icon name="upload" size={14} color={colorScales.gray[700]} />}
            onPress={() => {
              toastError('La carga de imágenes se administra desde el panel web.');
            }}
            disabled
          />
        </View>
      </View>
    </View>
  );
}

// ----------------------------------------------------------------------------
// Color field — swatch + hex input
// ----------------------------------------------------------------------------

function ColorField({
  label,
  value,
  onChange,
  error,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  const valid = isValidHex(value);
  const swatch = valid ? normalizeHex(value) : colorScales.gray[300];
  return (
    <View style={styles.colorField}>
      <Text style={styles.colorFieldLabel}>{label}</Text>
      <View style={styles.colorFieldRow}>
        <View style={[styles.colorSwatch, { backgroundColor: swatch }]}>
          {!valid ? <Icon name="alert-triangle" size={12} color={colorScales.amber[700]} /> : null}
        </View>
        <View style={{ flex: 1 }}>
          <Input
            value={value}
            onChangeText={onChange}
            placeholder="#000000"
            autoCapitalize="none"
            autoCorrect={false}
            error={error}
          />
        </View>
      </View>
    </View>
  );
}

// ----------------------------------------------------------------------------
// Time formatter
// ----------------------------------------------------------------------------

function formatSavedTime(date: Date): string {
  try {
    return new Intl.DateTimeFormat('es-CO', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(date);
  } catch {
    return date.toLocaleTimeString();
  }
}

// ============================================================================
// Styles
// ============================================================================

const styles = StyleSheet.create({
  // ── Sticky sub-header ───────────────────────────────────────────────────
  stickySubHeader: {
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    gap: spacing[2],
  },
  subHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colorScales.gray[100],
  },
  subHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  subHeaderTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
    lineHeight: typography.lineHeight.tight * typography.fontSize.base,
  },
  subHeaderSubtitle: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 2,
  },
  metadata: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginLeft: spacing[10], // align under subtitle (back button + gap)
  },
  badgePulse: {
    // La animación pulse no se replica en RN — basta con variant warning.
  },
  subHeaderActions: {
    flexDirection: 'row',
    marginTop: spacing[2],
  },

  // ── Tabs bar ────────────────────────────────────────────────────────────
  tabsBar: {
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
    paddingVertical: spacing[1],
  },

  // ── Scroll content ──────────────────────────────────────────────────────
  scrollContent: {
    padding: spacing[4],
    paddingBottom: spacing[12],
  },

  // ── Sections ────────────────────────────────────────────────────────────
  section: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    marginBottom: spacing[4],
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    padding: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  sectionIcon: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
    lineHeight: typography.lineHeight.tight * typography.fontSize.base,
  },
  sectionDescription: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: 2,
    lineHeight: typography.lineHeight.normal * typography.fontSize.xs,
  },
  sectionBody: {
    padding: spacing[4],
    gap: spacing[2],
  },

  // ── Preview grid ────────────────────────────────────────────────────────
  previewGrid: {
    gap: spacing[3],
  },
  brandPreview: {
    flexDirection: 'row',
    minHeight: 250,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  brandBar: {
    width: 64,
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[2.5],
    alignItems: 'center',
    gap: spacing[3],
  },
  brandMark: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.38)',
  },
  brandMarkImage: {
    width: '100%',
    height: '100%',
  },
  brandNav: {
    width: 38,
    height: 6,
    borderRadius: 999,
  },
  brandBody: {
    flex: 1,
    minWidth: 0,
    padding: spacing[4],
    justifyContent: 'space-between',
    gap: spacing[4],
  },
  brandHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing[3],
  },
  brandHeaderTag: {
    fontSize: 11,
    fontWeight: typography.fontWeight.bold,
    marginBottom: 2,
  },
  brandHeaderName: {
    fontSize: typography.fontSize.lg,
    fontWeight: '800' as const,
    lineHeight: typography.lineHeight.tight * typography.fontSize.lg,
  },
  brandPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
  },
  brandPillText: {
    fontSize: 12,
    fontWeight: typography.fontWeight.bold,
  },
  brandPanel: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    padding: spacing[3.5],
    gap: spacing[1.5],
    borderLeftWidth: 4,
  },
  brandPanelBar: {
    width: 36,
    height: 7,
    borderRadius: 999,
    marginBottom: spacing[1],
  },
  brandPanelStrong: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  brandPanelSmall: {
    fontSize: 12,
  },

  // ── Brand summary ───────────────────────────────────────────────────────
  brandSummary: {
    gap: spacing[2.5],
  },
  brandSummaryItem: {
    minHeight: 64,
    borderRadius: borderRadius.md,
    padding: spacing[3],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    backgroundColor: colors.card,
  },
  brandSummaryLabel: {
    fontSize: 12,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[500],
  },
  brandSummaryValue: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
    marginTop: 4,
  },

  // ── Asset card ──────────────────────────────────────────────────────────
  assetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.md,
    padding: spacing[3],
    minHeight: 100,
  },
  assetPreview: {
    width: 76,
    height: 76,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colorScales.gray[50],
  },
  assetPreviewFavicon: {
    borderRadius: borderRadius.lg,
  },
  assetPreviewImage: {
    width: '100%',
    height: '100%',
    padding: spacing[2],
  },
  assetContent: {
    flex: 1,
    gap: spacing[2.5],
  },
  assetLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
    marginBottom: 2,
  },
  assetDescription: {
    fontSize: 12,
    color: colorScales.gray[500],
    lineHeight: typography.lineHeight.tight * 12,
  },
  assetActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },

  // ── Color field ─────────────────────────────────────────────────────────
  colorField: {
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.md,
    padding: spacing[3],
    backgroundColor: colors.card,
  },
  colorFieldLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
    marginBottom: spacing[2],
  },
  colorFieldRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2.5],
  },
  colorSwatch: {
    width: 44,
    height: 36,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
});
