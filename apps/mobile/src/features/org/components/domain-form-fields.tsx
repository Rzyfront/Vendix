import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet, ActivityIndicator, ScrollView, Keyboard } from 'react-native';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { Icon } from '@/shared/components/icon/icon';
import { OrgDomainsService } from '@/features/org/services/org-domains.service';
import { OrgStoreService } from '@/features/org/services/org-store.service';
import type { StoreListItem } from '@/core/models/org-admin/store.types';
import type {
  AppType,
  Domain,
  DomainOwnership,
  DomainRoot,
  CreateDomainInput,
} from '@/core/models/org-admin/domains.types';
import {
  APP_TYPE_OPTIONS,
  DOMAIN_OWNERSHIP_OPTIONS,
  formatAppType,
  formatOwnership,
} from './domain-formatters';

interface DomainFormFieldsProps {
  /** Si viene, es edición; hostname/ownership/root quedan read-only. */
  initial?: Domain;
  submitting: boolean;
  onSubmit: (data: CreateDomainInput) => void;
  onCancel: () => void;
  submitLabel?: string;
  /** Si true, oculta el header interno (título+icono). Se usa cuando el
   *  componente se renderiza dentro de un `OrgCenteredModal` que provee
   *  su propio title/subtitle — patrón de paridad web. */
  hideHeader?: boolean;
}

/**
 * Form compartido para crear/editar dominios (ORG_ADMIN Dominios).
 *
 * La pantalla que llama controla la visibilidad del modal; este componente
 * solo se encarga de los campos. En modo edición `hostname`/`root_domain`/
 * `ownership` se renderizan read-only porque cambiar esos campos es un
 * operación destructiva (cambiar el root requiere re-emitir certificado).
 *
 * Validación:
 *   - En blur del hostname se llama `validateHostname` y `checkDuplicate`
 *     para mostrar errores inline antes de habilitar Submit.
 *   - `root_domain` se selecciona de la lista de `listRoots()`.
 *   - `store_id` es opcional (null = dominio de organización).
 */
export function DomainFormFields({
  initial,
  submitting,
  onSubmit,
  onCancel,
  submitLabel = 'Guardar',
  hideHeader = false,
}: DomainFormFieldsProps) {
  const isEdit = !!initial;

  const [hostname, setHostname] = useState(initial?.hostname ?? '');
  const [hostnameError, setHostnameError] = useState<string | null>(null);
  const [hostnameValidating, setHostnameValidating] = useState(false);
  const lastValidatedHostname = useRef<string | null>(initial?.hostname ?? null);
  const hostnameAbortRef = useRef<AbortController | null>(null);

  const [roots, setRoots] = useState<DomainRoot[]>([]);
  const [rootDomain, setRootDomain] = useState(initial?.root_domain ?? '');
  const [subdomain, setSubdomain] = useState(initial?.subdomain ?? '');

  const [stores, setStores] = useState<StoreListItem[]>([]);
  const [storeId, setStoreId] = useState<string | null>(initial?.store_id ?? null);

  const [appType, setAppType] = useState<AppType>(initial?.app_type ?? 'STORE_ECOMMERCE');
  const [ownership, setOwnership] = useState<DomainOwnership>(
    initial?.ownership ?? 'CUSTOM_DOMAIN',
  );
  const [isPrimary, setIsPrimary] = useState<boolean>(initial?.is_primary ?? false);

  const [openDropdown, setOpenDropdown] = useState<null | 'root' | 'store' | 'appType' | 'ownership'>(null);

  useEffect(() => {
    Promise.all([OrgDomainsService.listRoots().catch(() => []), OrgStoreService.list({ pageSize: 200 }).then((r) => r.data).catch(() => [])])
      .then(([r, s]) => {
        setRoots(r ?? []);
        setStores(s ?? []);
        if (!initial && r && r.length > 0 && !rootDomain) setRootDomain(r[0].root_domain);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const validateAndCheckDuplicate = async (value: string) => {
    if (!value || value === lastValidatedHostname.current) return;
    hostnameAbortRef.current?.abort();
    const ac = new AbortController();
    hostnameAbortRef.current = ac;
    setHostnameValidating(true);
    setHostnameError(null);
    try {
      const v = await OrgDomainsService.validateHostname(value);
      if (ac.signal.aborted) return;
      if (!v.valid) {
        setHostnameError(v.reason ?? 'Hostname inválido');
        return;
      }
      const dup = await OrgDomainsService.checkDuplicate(value);
      if (ac.signal.aborted) return;
      if (dup.duplicate) {
        setHostnameError('Este hostname ya está registrado');
        return;
      }
      lastValidatedHostname.current = value;
    } catch (e) {
      if (ac.signal.aborted) return;
      setHostnameError(e instanceof Error ? e.message : 'No se pudo validar el hostname');
    } finally {
      if (ac.signal.aborted) return;
      setHostnameValidating(false);
    }
  };

  const isValid =
    !!hostname.trim() &&
    !!rootDomain.trim() &&
    !hostnameError &&
    !!appType &&
    !!ownership;

  const handleSubmit = () => {
    if (!isValid) return;
    onSubmit({
      hostname: hostname.trim(),
      root_domain: rootDomain.trim(),
      subdomain: subdomain.trim() || undefined,
      store_id: storeId,
      app_type: appType,
      ownership,
      is_primary: isPrimary,
    });
  };

  return (
    <View style={styles.container}>
      {/* Header interno: solo se renderiza cuando NO está oculto por el
          modal padre (que provee su propio title/subtitle). */}
      {!hideHeader ? (
        <View style={styles.headerRow}>
          <View style={styles.headerIcon}>
            <Icon name="globe" size={20} color={colors.primary} />
          </View>
          <Text style={styles.headerTitle}>{isEdit ? 'Editar dominio' : 'Nuevo dominio'}</Text>
        </View>
      ) : null}

      <ScrollView style={styles.form} contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
        {/* Hostname */}
        <View style={styles.field}>
          <Text style={styles.label}>Hostname</Text>
          <View style={[styles.inputRow, hostnameError ? styles.inputRowError : null]}>
            <TextInput
              style={styles.input}
              value={hostname}
              onChangeText={(v) => {
                setHostname(v.toLowerCase());
                if (hostnameError) setHostnameError(null);
              }}
              onBlur={() => !isEdit && validateAndCheckDuplicate(hostname)}
              editable={!isEdit}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="mitienda.com"
              placeholderTextColor={colorScales.gray[400]}
            />
            {hostnameValidating ? <ActivityIndicator size="small" color={colors.primary} /> : null}
          </View>
          {hostnameError ? <Text style={styles.errorText}>{hostnameError}</Text> : null}
          {isEdit ? <Text style={styles.helperText}>El hostname no se puede cambiar. Crea un dominio nuevo si necesitas otro.</Text> : null}
        </View>

        {/* Root domain */}
        <View style={styles.field}>
          <Text style={styles.label}>Dominio raíz</Text>
          <Pressable
            style={styles.selectInput}
            onPress={() => {
              if (isEdit) return;
              Keyboard.dismiss();
              setOpenDropdown(openDropdown === 'root' ? null : 'root');
            }}
            disabled={isEdit}
          >
            <Text style={rootDomain ? styles.selectText : styles.selectPlaceholder}>
              {rootDomain || 'Selecciona un dominio raíz'}
            </Text>
            <Icon name="chevron-down" size={16} color={colorScales.gray[400]} />
          </Pressable>
          {openDropdown === 'root' && roots.length > 0 ? (
            <View style={styles.dropdown}>
              {roots.map((r) => (
                <Pressable
                  key={r.id}
                  style={[styles.dropdownItem, rootDomain === r.root_domain && styles.dropdownItemActive]}
                  onPress={() => {
                    setRootDomain(r.root_domain);
                    setOpenDropdown(null);
                  }}
                >
                  <Text style={[styles.dropdownItemText, rootDomain === r.root_domain && styles.dropdownItemTextActive]}>
                    {r.root_domain}
                  </Text>
                  {rootDomain === r.root_domain ? <Icon name="check" size={16} color={colors.primary} /> : null}
                </Pressable>
              ))}
            </View>
          ) : null}
          {isEdit ? <Text style={styles.helperText}>El dominio raíz no se puede cambiar.</Text> : null}
        </View>

        {/* Subdomain */}
        <View style={styles.field}>
          <Text style={styles.label}>Subdominio (opcional)</Text>
          <TextInput
            style={styles.textInput}
            value={subdomain}
            onChangeText={setSubdomain}
            placeholder="Ej: tienda, shop, www"
            placeholderTextColor={colorScales.gray[400]}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {/* Ownership */}
        <View style={styles.field}>
          <Text style={styles.label}>Tipo de propiedad</Text>
          <Pressable
            style={[styles.selectInput, isEdit && styles.selectInputDisabled]}
            onPress={() => {
              if (isEdit) return;
              Keyboard.dismiss();
              setOpenDropdown(openDropdown === 'ownership' ? null : 'ownership');
            }}
            disabled={isEdit}
          >
            <Text style={styles.selectText}>{formatOwnership(ownership)}</Text>
            <Icon name="chevron-down" size={16} color={colorScales.gray[400]} />
          </Pressable>
          {openDropdown === 'ownership' && !isEdit ? (
            <View style={styles.dropdown}>
              {DOMAIN_OWNERSHIP_OPTIONS.map((o) => (
                <Pressable
                  key={o.value}
                  style={[styles.dropdownItem, ownership === o.value && styles.dropdownItemActive]}
                  onPress={() => {
                    setOwnership(o.value);
                    setOpenDropdown(null);
                  }}
                >
                  <Text style={[styles.dropdownItemText, ownership === o.value && styles.dropdownItemTextActive]}>
                    {o.label}
                  </Text>
                  {ownership === o.value ? <Icon name="check" size={16} color={colors.primary} /> : null}
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        {/* App type */}
        <View style={styles.field}>
          <Text style={styles.label}>Tipo de app destino</Text>
          <Pressable
            style={styles.selectInput}
            onPress={() => {
              Keyboard.dismiss();
              setOpenDropdown(openDropdown === 'appType' ? null : 'appType');
            }}
          >
            <Text style={styles.selectText}>{formatAppType(appType)}</Text>
            <Icon name="chevron-down" size={16} color={colorScales.gray[400]} />
          </Pressable>
          {openDropdown === 'appType' ? (
            <View style={styles.dropdown}>
              {APP_TYPE_OPTIONS.map((o) => (
                <Pressable
                  key={o.value}
                  style={[styles.dropdownItem, appType === o.value && styles.dropdownItemActive]}
                  onPress={() => {
                    setAppType(o.value);
                    setOpenDropdown(null);
                  }}
                >
                  <Text style={[styles.dropdownItemText, appType === o.value && styles.dropdownItemTextActive]}>
                    {o.label}
                  </Text>
                  {appType === o.value ? <Icon name="check" size={16} color={colors.primary} /> : null}
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        {/* Store (optional) */}
        <View style={styles.field}>
          <Text style={styles.label}>Tienda asociada (opcional)</Text>
          <Pressable
            style={styles.selectInput}
            onPress={() => {
              Keyboard.dismiss();
              setOpenDropdown(openDropdown === 'store' ? null : 'store');
            }}
          >
            <Text style={storeId ? styles.selectText : styles.selectPlaceholder}>
              {storeId ? stores.find((s) => String(s.id) === storeId)?.name ?? 'Tienda' : 'Dominio de organización'}
            </Text>
            <Icon name="chevron-down" size={16} color={colorScales.gray[400]} />
          </Pressable>
          {openDropdown === 'store' ? (
            <View style={styles.dropdown}>
              <Pressable
                style={[styles.dropdownItem, storeId === null && styles.dropdownItemActive]}
                onPress={() => {
                  setStoreId(null);
                  setOpenDropdown(null);
                }}
              >
                <Text style={[styles.dropdownItemText, storeId === null && styles.dropdownItemTextActive]}>
                  Dominio de organización
                </Text>
                {storeId === null ? <Icon name="check" size={16} color={colors.primary} /> : null}
              </Pressable>
              {stores.map((s) => {
                const id = String(s.id);
                const active = storeId === id;
                return (
                  <Pressable
                    key={id}
                    style={[styles.dropdownItem, active && styles.dropdownItemActive]}
                    onPress={() => {
                      setStoreId(id);
                      setOpenDropdown(null);
                    }}
                  >
                    <Text style={[styles.dropdownItemText, active && styles.dropdownItemTextActive]}>{s.name}</Text>
                    {active ? <Icon name="check" size={16} color={colors.primary} /> : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>

        {/* is_primary toggle */}
        <Pressable
          style={styles.toggleRow}
          onPress={() => setIsPrimary((v) => !v)}
        >
          <View style={[styles.checkbox, isPrimary && styles.checkboxActive]}>
            {isPrimary ? <Icon name="check" size={12} color="#FFFFFF" /> : null}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.toggleLabel}>Marcar como dominio principal</Text>
            <Text style={styles.helperText}>El dominio principal se usa como URL canónica de la organización.</Text>
          </View>
        </Pressable>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.cancelBtn} onPress={onCancel} disabled={submitting}>
          <Text style={styles.cancelText}>Cancelar</Text>
        </Pressable>
        <Pressable
          style={[styles.submitBtn, (!isValid || submitting) && styles.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={!isValid || submitting}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Icon name="check" size={16} color="#FFFFFF" />
              <Text style={styles.submitText}>{submitLabel}</Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colorScales.green[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold as any,
    color: colorScales.gray[900],
  },
  form: { flex: 1 },
  formContent: { padding: spacing[4], gap: spacing[4] },
  field: { gap: spacing[1] },
  label: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[600],
    fontWeight: typography.fontWeight.semibold as any,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    backgroundColor: colors.background,
  },
  inputRowError: { borderColor: colors.error },
  input: {
    flex: 1,
    height: 44,
    fontSize: typography.fontSize.base,
    color: colorScales.gray[900],
  },
  textInput: {
    height: 44,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    fontSize: typography.fontSize.base,
    color: colorScales.gray[900],
    backgroundColor: colors.background,
  },
  errorText: {
    fontSize: typography.fontSize.xs,
    color: colors.error,
    marginTop: spacing[1],
  },
  helperText: {
    fontSize: typography.fontSize.xs,
    color: colorScales.gray[500],
    marginTop: spacing[1],
  },
  selectInput: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    backgroundColor: colors.background,
  },
  selectInputDisabled: { opacity: 0.6 },
  selectText: {
    fontSize: typography.fontSize.base,
    color: colorScales.gray[900],
    flex: 1,
  },
  selectPlaceholder: {
    fontSize: typography.fontSize.base,
    color: colorScales.gray[400],
    flex: 1,
  },
  dropdown: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
  },
  dropdownItemActive: { backgroundColor: colorScales.green[50] },
  dropdownItemText: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[700],
    flex: 1,
  },
  dropdownItemTextActive: { color: colors.primary, fontWeight: typography.fontWeight.semibold as any },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[3],
    backgroundColor: colorScales.gray[50],
    borderRadius: borderRadius.lg,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colorScales.gray[400],
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  checkboxActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  toggleLabel: {
    fontSize: typography.fontSize.sm,
    color: colorScales.gray[900],
    fontWeight: typography.fontWeight.medium as any,
  },
  footer: {
    flexDirection: 'row',
    gap: spacing[3],
    padding: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
  cancelBtn: {
    flex: 1,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
  },
  cancelText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold as any,
    color: colorScales.gray[700],
  },
  submitBtn: {
    flex: 2,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    backgroundColor: colors.primary,
    borderRadius: borderRadius.xl,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold as any,
    color: '#FFFFFF',
  },
});