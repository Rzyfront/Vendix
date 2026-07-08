import { useState, useEffect } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CustomerService } from '@/features/store/services/customer.service';
import type {
  CustomerState,
  CreateCustomerDto,
  PersonType,
  TaxRegime,
} from '@/features/store/types';
import {
  DOCUMENT_TYPES,
  findDocumentType,
} from '@/shared/constants/document-types';
import { Input } from '@/shared/components/input/input';
import { Button } from '@/shared/components/button/button';
import { Spinner } from '@/shared/components/spinner/spinner';
import { Selector } from '@/shared/components/selector/selector';
import { Toggle } from '@/shared/components/toggle/toggle';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { spacing, borderRadius, typography, colorScales, colors } from '@/shared/theme';

const STATE_OPTIONS: { label: string; value: CustomerState }[] = [
  { label: 'Activo', value: 'active' },
  { label: 'Inactivo', value: 'inactive' },
];

const TAX_REGIME_OPTIONS: { label: string; value: TaxRegime }[] = [
  { label: 'Régimen común', value: 'COMUN' },
  { label: 'Régimen simplificado', value: 'SIMPLIFICADO' },
  { label: 'Gran contribuyente', value: 'GRAN_CONTRIBUYENTE' },
];

const PERSON_TYPE_OPTIONS: { label: string; value: PersonType }[] = [
  { label: 'Persona natural', value: 'NATURAL' },
  { label: 'Persona jurídica', value: 'JURIDICA' },
];

const DOCUMENT_TYPE_SELECTOR_OPTIONS = [
  { label: 'Sin clasificar', value: '' },
  ...DOCUMENT_TYPES.map((d) => ({ label: d.label, value: d.code })),
];

export default function CreateCustomerScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const queryClient = useQueryClient();
  const isEditing = !!id;

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [documentType, setDocumentType] = useState<string>('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [taxRegime, setTaxRegime] = useState<string>('');
  const [personType, setPersonType] = useState<string>('');
  const [isWithholdingAgent, setIsWithholdingAgent] = useState(false);
  const [state, setState] = useState<CustomerState>('active');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: existingCustomer, isLoading: loadingCustomer } = useQuery({
    queryKey: ['customer', id],
    queryFn: () => CustomerService.getById(id!),
    enabled: !!id,
  });

  useEffect(() => {
    if (existingCustomer) {
      setFirstName(existingCustomer.first_name);
      setLastName(existingCustomer.last_name);
      setEmail(existingCustomer.email);
      setPhone(existingCustomer.phone || '');
      setDocumentType(existingCustomer.document_type || '');
      setDocumentNumber(existingCustomer.document_number || '');
      setTaxRegime((existingCustomer as any).tax_regime ?? '');
      setPersonType((existingCustomer as any).person_type ?? '');
      setIsWithholdingAgent((existingCustomer as any).is_withholding_agent ?? false);
      setState(existingCustomer.state);
    }
  }, [existingCustomer]);

  const createMutation = useMutation({
    mutationFn: (data: CreateCustomerDto) => CustomerService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer-stats'] });
      toastSuccess('Cliente creado exitosamente');
      router.back();
    },
    onError: () => toastError('Error al crear el cliente'),
  });

  const updateMutation = useMutation({
    mutationFn: (data: CreateCustomerDto) => CustomerService.update(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer', id] });
      toastSuccess('Cliente actualizado exitosamente');
      router.back();
    },
    onError: () => toastError('Error al actualizar el cliente'),
  });

  const validateDocumentNumber = (value: string): string | null => {
    if (!documentType) return null;
    const type = findDocumentType(documentType);
    if (!type) return null;
    if (value.length > type.maxLength) {
      return `Máximo ${type.maxLength} caracteres`;
    }
    if (value.length > 0 && !type.regex.test(value)) {
      return `Número de documento inválido para ${type.label}`;
    }
    return null;
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!firstName.trim()) newErrors.firstName = 'El nombre es obligatorio';
    if (!lastName.trim()) newErrors.lastName = 'El apellido es obligatorio';
    if (!email.trim()) {
      newErrors.email = 'El correo es obligatorio';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = 'Ingresa un correo válido';
    }
    if (!phone.trim()) {
      newErrors.phone = 'El teléfono es obligatorio';
    } else if (phone.trim().length < 7) {
      newErrors.phone = 'El teléfono debe tener al menos 7 caracteres';
    }
    const docNumError = validateDocumentNumber(documentNumber);
    if (docNumError) newErrors.documentNumber = docNumError;
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    const dto: CreateCustomerDto = {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email: email.trim(),
      phone: phone.trim() || undefined,
      document_type: documentType || undefined,
      document_number: documentNumber.trim() || undefined,
      tax_regime: (taxRegime || undefined) as TaxRegime | undefined,
      person_type: (personType || undefined) as PersonType | undefined,
      is_withholding_agent: isWithholdingAgent,
      state,
    };
    if (isEditing) {
      updateMutation.mutate(dto);
    } else {
      createMutation.mutate(dto);
    }
  };

  const documentNumberPlaceholder = findDocumentType(documentType)?.placeholder
    ?? 'Selecciona primero el tipo';

  if (isEditing && loadingCustomer) {
    return (
      <View style={styles.loadingContainer}>
        <Spinner />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.formContent}>
          <Input
            label="Correo electrónico"
            value={email}
            onChangeText={setEmail}
            error={errors.email}
            placeholder="cliente@ejemplo.com"
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <View style={styles.row}>
            <View style={styles.flex1}>
              <Input
                label="Nombre *"
                value={firstName}
                onChangeText={setFirstName}
                error={errors.firstName}
                placeholder="Ej. María"
              />
            </View>
            <View style={styles.flex1}>
              <Input
                label="Apellido *"
                value={lastName}
                onChangeText={setLastName}
                error={errors.lastName}
                placeholder="Ej. Rodríguez"
              />
            </View>
          </View>

          <Input
            label="Teléfono *"
            value={phone}
            onChangeText={setPhone}
            error={errors.phone}
            placeholder="+57 300 000 0000"
            keyboardType="phone-pad"
          />

          <View style={styles.row}>
            <View style={styles.flex1}>
              <Selector
                label="Tipo de documento"
                value={documentType}
                onChange={(v) => setDocumentType(v as string)}
                options={DOCUMENT_TYPE_SELECTOR_OPTIONS}
                placeholder="Selecciona un tipo"
              />
            </View>
            <View style={styles.flex1}>
              <Input
                label="Número de documento"
                value={documentNumber}
                onChangeText={setDocumentNumber}
                error={errors.documentNumber}
                placeholder={documentNumberPlaceholder}
                autoCapitalize="characters"
                editable={!!documentType}
              />
            </View>
          </View>

          <View style={styles.fiscalSection}>
            <Text style={styles.fiscalHeader}>Información fiscal</Text>

            <View style={styles.row}>
              <View style={styles.flex1}>
                <Selector
                  label="Régimen tributario"
                  value={taxRegime}
                  onChange={(v) => setTaxRegime(v as string)}
                  options={TAX_REGIME_OPTIONS}
                  placeholder="Selecciona un régimen"
                />
              </View>
              <View style={styles.flex1}>
                <Selector
                  label="Tipo de persona"
                  value={personType}
                  onChange={(v) => setPersonType(v as string)}
                  options={PERSON_TYPE_OPTIONS}
                  placeholder="Selecciona un tipo"
                />
              </View>
            </View>

            <Toggle
              value={isWithholdingAgent}
              onChange={setIsWithholdingAgent}
              label="¿Es agente retenedor?"
              description="Marca si el cliente es responsable de practicar retenciones en la fuente."
            />
          </View>

          <View style={styles.sectionGap}>
            <Text style={styles.sectionLabel}>Estado</Text>
            <View style={styles.rowGap2}>
              {STATE_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.value}
                  onPress={() => setState(opt.value)}
                  style={[
                    styles.stateButton,
                    state === opt.value
                      ? styles.stateButtonActive
                      : styles.stateButtonInactive,
                  ]}
                >
                  <Text
                    style={[
                      styles.stateButtonText,
                      state === opt.value
                        ? styles.stateTextActive
                        : styles.stateTextInactive,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title={isEditing ? 'Guardar Cambios' : 'Crear Cliente'}
          onPress={handleSubmit}
          loading={createMutation.isPending || updateMutation.isPending}
          fullWidth
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  loadingContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  formContent: { padding: spacing[4], gap: spacing[4] },
  row: { flexDirection: 'row', gap: spacing[3] },
  flex1: { flex: 1 },
  sectionGap: { gap: spacing[2] },
  sectionLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[500],
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  rowGap2: { flexDirection: 'row', gap: spacing[2] },
  stateButton: {
    flex: 1,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
    alignItems: 'center',
  },
  stateButtonActive: { backgroundColor: colors.primary },
  stateButtonInactive: { backgroundColor: colorScales.gray[100] },
  stateButtonText: { fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.medium },
  stateTextActive: { color: colors.background },
  stateTextInactive: { color: colorScales.gray[700] },
  fiscalSection: {
    gap: spacing[4],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
  },
  fiscalHeader: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colorScales.gray[900],
  },
  footer: { padding: spacing[4], borderTopWidth: 1, borderTopColor: colorScales.gray[200] },
});
