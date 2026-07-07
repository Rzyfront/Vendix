import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Modal } from 'react-native';
import { Icon } from '@/shared/components/icon/icon';
import { Spinner } from '@/shared/components/spinner/spinner';
import { borderRadius, colorScales, colors, shadows, spacing, typography } from '@/shared/theme';
import { CURRENCY_OPTIONS, TAX_REGIME_OPTIONS, PERSON_TYPE_OPTIONS } from '@/features/store/constants/inventory-labels';

export interface SupplierFormData {
  name: string;
  code: string;
  contact_person: string;
  email: string;
  phone: string;
  mobile: string;
  website: string;
  tax_id: string;
  payment_terms: string;
  currency: string;
  lead_time_days: number | null;
  notes: string;
  address: string;
  is_active: boolean;
  tax_regime: string;
  person_type: string;
  is_self_withholder: boolean;
}

interface SupplierFormModalProps {
  visible: boolean;
  editingId: string | null;
  form: SupplierFormData;
  setForm: (form: SupplierFormData) => void;
  isSubmitting: boolean;
  isFormValid: boolean;
  onClose: () => void;
  onSubmit: () => void;
  showTaxRegimeDropdown: boolean;
  setShowTaxRegimeDropdown: (v: boolean) => void;
  showPersonTypeDropdown: boolean;
  setShowPersonTypeDropdown: (v: boolean) => void;
  showCurrencyDropdown: boolean;
  setShowCurrencyDropdown: (v: boolean) => void;
  isStoreScope: boolean;
}

/**
 * SupplierFormModal — modal de creación / edición de proveedor.
 * Extraído de suppliers.tsx. Misma estructura visual que la web.
 */
export default function SupplierFormModal({
  visible,
  editingId,
  form,
  setForm,
  isSubmitting,
  isFormValid,
  onClose,
  onSubmit,
  showTaxRegimeDropdown,
  setShowTaxRegimeDropdown,
  showPersonTypeDropdown,
  setShowPersonTypeDropdown,
  showCurrencyDropdown,
  setShowCurrencyDropdown,
  isStoreScope,
}: SupplierFormModalProps) {
  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.createModalOverlay}>
        <View style={styles.createModal}>
          <View style={styles.createHeader}>
            <View style={styles.createHeaderText}>
              <Text style={styles.createTitle}>
                {editingId ? 'Editar Proveedor' : 'Nuevo Proveedor'}
              </Text>
              <Text style={styles.createSubtitle}>
                {editingId ? 'Modifica los datos del proveedor' : 'Agrega un nuevo proveedor a tu tienda'}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={styles.createCloseBtn}>
              <Icon name="x" size={22} color={colorScales.gray[500]} />
            </Pressable>
          </View>

          <ScrollView style={styles.createBody} contentContainerStyle={styles.createBodyContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* Identificación */}
            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Código <Text style={styles.required}>*</Text></Text>
              <TextInput
                style={styles.inputField}
                value={form.code ?? ''}
                onChangeText={(t) => setForm({ ...form, code: t })}
                placeholder="PROV-001"
                placeholderTextColor={colorScales.gray[400]}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Nombre <Text style={styles.required}>*</Text></Text>
              <TextInput
                style={styles.inputField}
                value={form.name}
                onChangeText={(t) => setForm({ ...form, name: t })}
                placeholder="Nombre del proveedor"
                placeholderTextColor={colorScales.gray[400]}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Persona de Contacto</Text>
              <TextInput
                style={styles.inputField}
                value={form.contact_person ?? ''}
                onChangeText={(t) => setForm({ ...form, contact_person: t })}
                placeholder="Nombre del contacto"
                placeholderTextColor={colorScales.gray[400]}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Email</Text>
              <TextInput
                style={styles.inputField}
                value={form.email ?? ''}
                onChangeText={(t) => setForm({ ...form, email: t })}
                placeholder="email@ejemplo.com"
                placeholderTextColor={colorScales.gray[400]}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <View style={styles.formRow}>
              <View style={[styles.formGroup, { flex: 1 }]}>
                <Text style={styles.formLabel}>Teléfono</Text>
                <TextInput
                  style={styles.inputField}
                  value={form.phone ?? ''}
                  onChangeText={(t) => setForm({ ...form, phone: t })}
                  placeholder="+1 234 567 890"
                  placeholderTextColor={colorScales.gray[400]}
                  keyboardType="phone-pad"
                />
              </View>
              <View style={[styles.formGroup, { flex: 1 }]}>
                <Text style={styles.formLabel}>Móvil</Text>
                <TextInput
                  style={styles.inputField}
                  value={form.mobile ?? ''}
                  onChangeText={(t) => setForm({ ...form, mobile: t })}
                  placeholder="+1 234 567 890"
                  placeholderTextColor={colorScales.gray[400]}
                  keyboardType="phone-pad"
                />
              </View>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Sitio Web</Text>
              <TextInput
                style={styles.inputField}
                value={form.website ?? ''}
                onChangeText={(t) => setForm({ ...form, website: t })}
                placeholder="https://ejemplo.com"
                placeholderTextColor={colorScales.gray[400]}
                autoCapitalize="none"
                keyboardType="url"
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>ID Fiscal / NIT</Text>
              <TextInput
                style={styles.inputField}
                value={form.tax_id ?? ''}
                onChangeText={(t) => setForm({ ...form, tax_id: t })}
                placeholder="123-456-789"
                placeholderTextColor={colorScales.gray[400]}
              />
            </View>

            <View style={styles.formRow}>
              <View style={[styles.formGroup, { flex: 1 }]}>
                <Text style={styles.formLabel}>Régimen Tributario</Text>
                <Pressable
                  style={styles.inputField}
                  onPress={() => setShowTaxRegimeDropdown(!showTaxRegimeDropdown)}
                >
                  <Text style={styles.inputFieldText}>
                    {TAX_REGIME_OPTIONS.find((r) => r.value === form.tax_regime)?.label ?? 'Seleccionar'}
                  </Text>
                  <Icon
                    name={showTaxRegimeDropdown ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={colorScales.gray[500]}
                  />
                </Pressable>
                {showTaxRegimeDropdown && (
                  <View style={styles.dropdownList}>
                    {TAX_REGIME_OPTIONS.map((r) => (
                      <Pressable
                        key={r.value}
                        onPress={() => {
                          setForm({ ...form, tax_regime: r.value });
                          setShowTaxRegimeDropdown(false);
                        }}
                        style={[
                          styles.dropdownOption,
                          form.tax_regime === r.value && styles.dropdownOptionActive,
                        ]}
                      >
                        <Text style={[styles.dropdownOptionText, form.tax_regime === r.value && styles.dropdownOptionTextActive]}>
                          {r.label}
                        </Text>
                        {form.tax_regime === r.value && <Icon name="check" size={14} color={colors.primary} />}
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
              <View style={[styles.formGroup, { flex: 1 }]}>
                <Text style={styles.formLabel}>Tipo de Persona</Text>
                <Pressable
                  style={styles.inputField}
                  onPress={() => setShowPersonTypeDropdown(!showPersonTypeDropdown)}
                >
                  <Text style={styles.inputFieldText}>
                    {PERSON_TYPE_OPTIONS.find((p) => p.value === form.person_type)?.label ?? 'Seleccionar'}
                  </Text>
                  <Icon
                    name={showPersonTypeDropdown ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={colorScales.gray[500]}
                  />
                </Pressable>
                {showPersonTypeDropdown && (
                  <View style={styles.dropdownList}>
                    {PERSON_TYPE_OPTIONS.map((p) => (
                      <Pressable
                        key={p.value}
                        onPress={() => {
                          setForm({ ...form, person_type: p.value });
                          setShowPersonTypeDropdown(false);
                        }}
                        style={[
                          styles.dropdownOption,
                          form.person_type === p.value && styles.dropdownOptionActive,
                        ]}
                      >
                        <Text style={[styles.dropdownOptionText, form.person_type === p.value && styles.dropdownOptionTextActive]}>
                          {p.label}
                        </Text>
                        {form.person_type === p.value && <Icon name="check" size={14} color={colors.primary} />}
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            </View>

            <View style={styles.toggleRow}>
              <View style={styles.toggleRowInfo}>
                <Text style={styles.toggleLabel}>¿Es autorretenedor?</Text>
                <Text style={styles.toggleHint}>Marca si el proveedor practica autorretención</Text>
              </View>
              <Pressable
                style={[styles.toggleSwitch, form.is_self_withholder && styles.toggleSwitchOn]}
                onPress={() => setForm({ ...form, is_self_withholder: !form.is_self_withholder })}
              >
                <View style={[styles.toggleKnob, form.is_self_withholder && styles.toggleKnobOn]} />
              </Pressable>
            </View>

            <View style={styles.formRow}>
              <View style={[styles.formGroup, { flex: 1 }]}>
                <Text style={styles.formLabel}>Términos de Pago</Text>
                <TextInput
                  style={styles.inputField}
                  value={form.payment_terms ?? ''}
                  onChangeText={(t) => setForm({ ...form, payment_terms: t })}
                  placeholder="Ej: Net 30"
                  placeholderTextColor={colorScales.gray[400]}
                />
              </View>
              <View style={[styles.formGroup, { flex: 1 }]}>
                <Text style={styles.formLabel}>Moneda</Text>
                <Pressable
                  style={styles.inputField}
                  onPress={() => setShowCurrencyDropdown(!showCurrencyDropdown)}
                >
                  <Text style={styles.inputFieldText}>
                    {CURRENCY_OPTIONS.find((c) => c.value === form.currency)?.label.split(' - ')[0] ?? 'Seleccionar'}
                  </Text>
                  <Icon
                    name={showCurrencyDropdown ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={colorScales.gray[500]}
                  />
                </Pressable>
                {showCurrencyDropdown && (
                  <View style={styles.dropdownList}>
                    {CURRENCY_OPTIONS.map((c) => (
                      <Pressable
                        key={c.value}
                        onPress={() => {
                          setForm({ ...form, currency: c.value });
                          setShowCurrencyDropdown(false);
                        }}
                        style={[
                          styles.dropdownOption,
                          form.currency === c.value && styles.dropdownOptionActive,
                        ]}
                      >
                        <Text style={[styles.dropdownOptionText, form.currency === c.value && styles.dropdownOptionTextActive]}>
                          {c.label}
                        </Text>
                        {form.currency === c.value && <Icon name="check" size={14} color={colors.primary} />}
                      </Pressable>
                    ))}
                  </View>
                )}
              </View>
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.formLabel}>Días de Entrega</Text>
              <TextInput
                style={styles.inputField}
                value={form.lead_time_days != null ? String(form.lead_time_days) : ''}
                onChangeText={(t) => setForm({ ...form, lead_time_days: t ? Number(t) || null : null })}
                placeholder="15"
                placeholderTextColor={colorScales.gray[400]}
                keyboardType="numeric"
              />
            </View>

            {/* Proveedor activo — toggle (estilo web) */}
            {isStoreScope && (
              <Pressable
                style={styles.toggleRow}
                onPress={() => setForm({ ...form, is_active: !form.is_active })}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.toggleLabel}>Proveedor activo</Text>
                  <Text style={styles.toggleHint}>Desactiva para ocultar este proveedor de las listas</Text>
                </View>
                <View style={[styles.toggleSwitch, form.is_active && styles.toggleSwitchOn]}>
                  <View style={[styles.toggleKnob, form.is_active && styles.toggleKnobOn]} />
                </View>
              </Pressable>
            )}
          </ScrollView>

          <View style={styles.createFooter}>
            <Pressable style={styles.cancelBtn} onPress={onClose}>
              <Text style={styles.cancelBtnText}>Cancelar</Text>
            </Pressable>
            <View style={styles.actionSpacer} />
            <Pressable
              style={[styles.confirmBtn, (!isFormValid || isSubmitting) && styles.confirmBtnDisabled]}
              onPress={onSubmit}
              disabled={!isFormValid || isSubmitting}
            >
              {isSubmitting ? (
                <Spinner size="sm" />
              ) : (
                <Text style={styles.confirmBtnText}>
                  {isSubmitting ? 'Guardando…' : editingId ? 'Guardar Cambios' : 'Crear Proveedor'}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  createModalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: spacing[4] },
  createModal: {
    backgroundColor: colors.background, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colorScales.gray[200], width: '100%', maxWidth: 520, maxHeight: '90%',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 24, elevation: 8,
  },
  createHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3], paddingHorizontal: spacing[4], paddingTop: spacing[3], paddingBottom: spacing[3], borderBottomWidth: 1, borderBottomColor: colorScales.gray[200] },
  createHeaderText: { flex: 1 },
  createTitle: { fontSize: typography.fontSize.base, fontWeight: '700' as any, color: colorScales.gray[900] },
  createSubtitle: { fontSize: 11, color: colorScales.gray[500], marginTop: 2 },
  createCloseBtn: { padding: spacing[1] },
  createBody: { flexGrow: 0, flexShrink: 1, maxHeight: 480 },
  createBodyContent: { padding: spacing[4], gap: spacing[3] },
  formGroup: { marginBottom: spacing[3] },
  formRow: { flexDirection: 'row', gap: spacing[3] },
  formLabel: { fontSize: typography.fontSize.xs, fontWeight: '600' as any, color: colorScales.gray[500], marginBottom: spacing[2], textTransform: 'uppercase' as any, letterSpacing: 1 },
  required: { color: colors.error },
  inputField: {
    borderWidth: 1, borderColor: colorScales.gray[200], borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3], paddingVertical: spacing[2.5], fontSize: 14, color: colorScales.gray[900], backgroundColor: colors.background,
    minHeight: 40, justifyContent: 'center' as any,
  },
  inputFieldText: { fontSize: 14, color: colorScales.gray[900], flex: 1 },
  dropdownList: { marginTop: 4, borderWidth: 1, borderColor: colorScales.gray[200], borderRadius: borderRadius.lg, backgroundColor: colors.background, overflow: 'hidden' },
  dropdownOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing[2.5], paddingHorizontal: spacing[3], borderBottomWidth: 1, borderBottomColor: colorScales.gray[100] },
  dropdownOptionActive: { backgroundColor: colorScales.green[50] },
  dropdownOptionText: { fontSize: 14, color: colorScales.gray[700] },
  dropdownOptionTextActive: { fontWeight: '600' as any, color: colors.primary },
  textArea: { minHeight: 60, textAlignVertical: 'top' as any },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[3], paddingVertical: spacing[2] },
  toggleRowInfo: { flex: 1 },
  toggleLabel: { fontSize: 14, fontWeight: '700' as any, color: colorScales.gray[900] },
  toggleHint: { fontSize: 11, color: colorScales.gray[500], marginTop: 2 },
  toggleSwitch: { width: 44, height: 26, borderRadius: 13, backgroundColor: colorScales.gray[300], padding: 2, justifyContent: 'center' },
  toggleSwitchOn: { backgroundColor: colors.primary },
  toggleKnob: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.background, ...shadows.sm, alignItems: 'center', justifyContent: 'center' },
  toggleKnobOn: { transform: [{ translateX: 18 }] },
  createFooter: { flexDirection: 'row', paddingHorizontal: spacing[4], paddingTop: spacing[3], paddingBottom: spacing[4], borderTopWidth: 1, borderTopColor: colorScales.gray[200], backgroundColor: colors.background, gap: spacing[2] },
  cancelBtn: { flex: 1, paddingVertical: 10, borderRadius: borderRadius.full, backgroundColor: colorScales.gray[900], alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { fontSize: 13, fontWeight: '700' as any, color: colors.background },
  actionSpacer: { width: spacing[3] },
  confirmBtn: { flex: 1, paddingVertical: 10, borderRadius: borderRadius.full, backgroundColor: colorScales.green[100], alignItems: 'center', justifyContent: 'center' },
  confirmBtnDisabled: { backgroundColor: colorScales.gray[100] },
  confirmBtnText: { fontSize: 13, fontWeight: '700' as any, color: colorScales.green[800] },
});
