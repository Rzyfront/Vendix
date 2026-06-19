import { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Keyboard } from 'react-native';
import { BottomSheet } from '@/shared/components/bottom-sheet/bottom-sheet';
import { Icon } from '@/shared/components/icon/icon';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';
import { OrgStoreService } from '@/features/org/services/org-store.service';
import type { StoreListItem } from '@/core/models/org-admin/store.types';
import type { DomainOwnership, DomainStatus } from '@/core/models/org-admin/domains.types';
import {
  APP_TYPE_OPTIONS,
  DOMAIN_OWNERSHIP_OPTIONS,
  DOMAIN_STATUS_OPTIONS,
} from './domain-formatters';
import type { DomainFilters } from './domain-filters.types';
import { EMPTY_FILTERS, hasActiveFilters } from './domain-filters.types';

interface DomainFiltersModalProps {
  visible: boolean;
  initial: DomainFilters;
  onClose: () => void;
  onApply: (filters: DomainFilters) => void;
}

/**
 * Modal de filtros para la lista de dominios.
 *
 * Espejo del `OptionsDropdownComponent` que usa la web en `domains.component.ts`.
 * Combina en un solo BottomSheet los 3 selects:
 *   - Estado: 16 statuses (PENDING, ACTIVE, FAILED, …)
 *   - Tipo (Ownership): VENDIX_SUBDOMAIN / CUSTOM_DOMAIN / CUSTOM_SUBDOMAIN / THIRD_PARTY_SUBDOMAIN
 *   - Tienda: Todas / Organización (sentinel) / tiendas reales del OrgStoreService
 *
 * El botón "Aplicar" cierra y propaga; "Limpiar" resetea a `EMPTY_FILTERS`
 * pero no cierra, para que el usuario pueda ver el reset antes de aplicar.
 */
export function DomainFiltersModal({ visible, initial, onClose, onApply }: DomainFiltersModalProps) {
  const [draft, setDraft] = useState<DomainFilters>(initial);
  const [stores, setStores] = useState<StoreListItem[]>([]);
  const [storesLoading, setStoresLoading] = useState(false);
  const [openSelect, setOpenSelect] = useState<null | 'status' | 'ownership' | 'store'>(null);

  useEffect(() => {
    if (!visible) return;
    setDraft(initial);
    setOpenSelect(null);
    if (stores.length === 0) {
      setStoresLoading(true);
      OrgStoreService.list({ pageSize: 200 })
        .then((r) => setStores(r.data ?? []))
        .catch(() => setStores([]))
        .finally(() => setStoresLoading(false));
    }
  }, [visible, initial, stores.length]);

  const handleApply = () => {
    onApply(draft);
    onClose();
  };

  const handleClear = () => {
    setDraft(EMPTY_FILTERS);
    setOpenSelect(null);
  };

  const statusLabel = draft.status ? DOMAIN_STATUS_OPTIONS.find((o) => o.value === draft.status)?.label ?? draft.status : 'Todos';
  const ownershipLabel = draft.ownership ? DOMAIN_OWNERSHIP_OPTIONS.find((o) => o.value === draft.ownership)?.label ?? draft.ownership : 'Todos';
  const storeLabel =
    draft.storeId === ''
      ? 'Todas'
      : draft.storeId === '__organization__'
      ? 'Organización'
      : stores.find((s) => String(s.id) === draft.storeId)?.name ?? 'Tienda';

  return (
    <BottomSheet visible={visible} onClose={onClose} snapPoint="full">
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.headerIcon}>
            <Icon name="filter" size={20} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Filtros</Text>
            <Text style={styles.subtitle}>
              {hasActiveFilters(draft) ? 'Filtros activos' : 'Mostrando todos los dominios'}
            </Text>
          </View>
        </View>
        <Pressable onPress={onClose} style={styles.closeBtn}>
          <Icon name="x" size={24} color={colorScales.gray[500]} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Status */}
        <FilterSection
          label="Estado"
          value={statusLabel}
          active={!!draft.status}
          open={openSelect === 'status'}
          onToggle={() => {
            Keyboard.dismiss();
            setOpenSelect(openSelect === 'status' ? null : 'status');
          }}
        >
          {DOMAIN_STATUS_OPTIONS.map((o) => (
            <OptionRow
              key={o.value}
              label={o.label}
              active={draft.status === o.value}
              onPress={() => {
                setDraft((d) => ({ ...d, status: d.status === o.value ? '' : (o.value as DomainStatus) }));
                setOpenSelect(null);
              }}
            />
          ))}
        </FilterSection>

        {/* Ownership */}
        <FilterSection
          label="Tipo"
          value={ownershipLabel}
          active={!!draft.ownership}
          open={openSelect === 'ownership'}
          onToggle={() => {
            Keyboard.dismiss();
            setOpenSelect(openSelect === 'ownership' ? null : 'ownership');
          }}
        >
          {DOMAIN_OWNERSHIP_OPTIONS.map((o) => (
            <OptionRow
              key={o.value}
              label={o.label}
              active={draft.ownership === o.value}
              onPress={() => {
                setDraft((d) => ({ ...d, ownership: d.ownership === o.value ? '' : (o.value as DomainOwnership) }));
                setOpenSelect(null);
              }}
            />
          ))}
        </FilterSection>

        {/* Store */}
        <FilterSection
          label="Tienda"
          value={storeLabel}
          active={!!draft.storeId}
          open={openSelect === 'store'}
          onToggle={() => {
            Keyboard.dismiss();
            setOpenSelect(openSelect === 'store' ? null : 'store');
          }}
        >
          <OptionRow
            label="Todas"
            active={draft.storeId === ''}
            onPress={() => {
              setDraft((d) => ({ ...d, storeId: '' }));
              setOpenSelect(null);
            }}
          />
          <OptionRow
            label="Organización"
            active={draft.storeId === '__organization__'}
            onPress={() => {
              setDraft((d) => ({ ...d, storeId: d.storeId === '__organization__' ? '' : '__organization__' }));
              setOpenSelect(null);
            }}
          />
          {storesLoading ? (
            <View style={styles.optionRow}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : stores.length === 0 ? (
            <Text style={styles.helperText}>No hay tiendas registradas</Text>
          ) : (
            stores.map((s) => {
              const id = String(s.id);
              return (
                <OptionRow
                  key={id}
                  label={s.name}
                  active={draft.storeId === id}
                  onPress={() => {
                    setDraft((d) => ({ ...d, storeId: d.storeId === id ? '' : id }));
                    setOpenSelect(null);
                  }}
                />
              );
            })
          )}
        </FilterSection>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable style={styles.clearBtn} onPress={handleClear}>
          <Icon name="rotate-ccw" size={14} color={colorScales.gray[600]} />
          <Text style={styles.clearText}>Limpiar</Text>
        </Pressable>
        <Pressable style={styles.applyBtn} onPress={handleApply}>
          <Icon name="check" size={16} color="#FFFFFF" />
          <Text style={styles.applyText}>Aplicar</Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponentes
// ─────────────────────────────────────────────────────────────────────────────

function FilterSection({
  label,
  value,
  active,
  open,
  onToggle,
  children,
}: {
  label: string;
  value: string;
  active: boolean;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        style={[styles.selectInput, active && styles.selectInputActive]}
        onPress={onToggle}
      >
        <Text style={[styles.selectText, !active && styles.selectPlaceholder]} numberOfLines={1}>
          {value}
        </Text>
        <Icon
          name={open ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colorScales.gray[400]}
        />
      </Pressable>
      {open ? <View style={styles.options}>{children}</View> : null}
    </View>
  );
}

function OptionRow({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.optionRow, active && styles.optionRowActive]} onPress={onPress}>
      <Text style={[styles.optionText, active && styles.optionTextActive]} numberOfLines={1}>
        {label}
      </Text>
      {active ? <Icon name="check" size={14} color={colors.primary} /> : null}
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[200],
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], flex: 1, minWidth: 0 },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colorScales.green[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colorScales.gray[900],
  },
  subtitle: { fontSize: typography.fontSize.xs, color: colorScales.gray[500], marginTop: 2 },
  closeBtn: { padding: spacing[1] },
  body: { flex: 1 },
  bodyContent: { padding: spacing[4], gap: spacing[4] },
  section: { gap: spacing[2] },
  label: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[600],
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  selectInput: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: colorScales.gray[300],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    backgroundColor: colors.background,
  },
  selectInputActive: { borderColor: colors.primary },
  selectText: { fontSize: typography.fontSize.base, color: colorScales.gray[900], flex: 1 },
  selectPlaceholder: { color: colorScales.gray[400] },
  options: {
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
    gap: spacing[2],
  },
  optionRowActive: { backgroundColor: colorScales.green[50] },
  optionText: { fontSize: typography.fontSize.sm, color: colorScales.gray[700], flex: 1 },
  optionTextActive: { color: colors.primary, fontWeight: typography.fontWeight.semibold },
  helperText: { fontSize: typography.fontSize.xs, color: colorScales.gray[500] },
  footer: {
    flexDirection: 'row',
    gap: spacing[3],
    padding: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
  clearBtn: {
    flex: 1,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colorScales.gray[300],
  },
  clearText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[700],
  },
  applyBtn: {
    flex: 2,
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    backgroundColor: colors.primary,
    borderRadius: borderRadius.xl,
  },
  applyText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.bold,
    color: '#FFFFFF',
  },
});
