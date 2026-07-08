import { useState } from 'react';
import {
  Modal as RNModal,
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Input, Textarea, Button } from '@/shared/components';
import { Icon } from '@/shared/components/icon/icon';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { BrandService } from '@/features/store/services/brand.service';
import type { Brand } from '@/features/store/types';
import { colors, colorScales, spacing, borderRadius, typography } from '@/shared/theme';

interface BrandQuickCreateProps {
  visible: boolean;
  onClose: () => void;
  onCreated: (brand: Brand) => void;
}

const NAME_MIN_LENGTH = 2;
const NAME_MAX_LENGTH = 100;
const DESCRIPTION_MAX_LENGTH = 1000;
const CARD_MAX_WIDTH = 480;

export function BrandQuickCreate({ visible, onClose, onCreated }: BrandQuickCreateProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  // Errores por campo (mirror del `getErrorMessage` web). Sólo se
  // muestran después de `touched` para no asustar al usuario antes
  // de que haya interactuado con el input.
  const [touched, setTouched] = useState<{ name?: boolean }>({});

  const mutation = useMutation({
    mutationFn: () =>
      // Espejo exacto del web: envía sólo `name` y `description`. El
      // backend acepta `state` e `is_featured` opcionales pero no los
      // exponemos en este modal (mirror de `app-brand-quick-create`).
      BrandService.create({
        name: name.trim(),
        description: description.trim() || undefined,
      }),
    onSuccess: (brand) => {
      toastSuccess('Marca creada exitosamente');
      queryClient.invalidateQueries({ queryKey: ['product-brands'] });
      queryClient.invalidateQueries({ queryKey: ['brands'] });
      queryClient.invalidateQueries({ queryKey: ['brands-stats'] });
      onCreated(brand);
      reset();
      onClose();
    },
    onError: (err: any) => {
      toastError(err?.response?.data?.message || 'Error al crear la marca');
    },
  });

  function reset() {
    setName('');
    setDescription('');
    setTouched({});
  }

  function validate(): string | null {
    const trimmed = name.trim();
    if (!trimmed) return 'Este campo es obligatorio';
    if (trimmed.length < NAME_MIN_LENGTH) return `Mínimo ${NAME_MIN_LENGTH} caracteres requeridos`;
    if (trimmed.length > NAME_MAX_LENGTH) return `Máximo ${NAME_MAX_LENGTH} caracteres permitidos`;
    return null;
  }

  function handleSubmit() {
    // Marcamos todos como touched para que el error sea visible si
    // el usuario pulsa Crear sin tocar el input.
    setTouched({ name: true });
    const nameError = validate();
    if (nameError) {
      toastError(nameError);
      return;
    }
    mutation.mutate();
  }

  function handleClose() {
    if (mutation.isPending) return;
    reset();
    onClose();
  }

  // Sólo mostramos el error después de que el usuario haya tocado el
  // campo (mirror del patrón `field.touched` del web).
  const nameError = touched.name ? validate() : null;

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.root}
      >
        {/* Backdrop — tap fuera del card cierra el modal. */}
        <Pressable style={styles.backdrop} onPress={handleClose} />

        {/* Card centrado con max-width 480px (mirror web `[size]="'md'"`). */}
        <View style={styles.cardWrapper}>
          <View style={styles.card}>
            {/* Header — título a la izquierda, X close a la derecha.
                Sin border-bottom para coincidir con el look limpio del web
                (la separación visible viene del border-top del footer). */}
            <View style={styles.header}>
              <View style={styles.headerTitleWrap}>
                <Text style={styles.headerTitle} numberOfLines={1}>
                  Crear Nueva Marca
                </Text>
              </View>
              <Pressable
                onPress={handleClose}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.closeButton,
                  pressed && { backgroundColor: colorScales.gray[100] },
                ]}
                accessibilityLabel="Cerrar modal"
              >
                <Icon name="x" size={20} color={colors.text.secondary} />
              </Pressable>
            </View>

            {/* Body — ScrollView con padding y gap para los inputs.
                `flexGrow: 0` evita que el body se estire cuando el
                contenido es menor que el alto disponible (mantiene la
                card compacta, tal como en el web). */}
            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {/* Nombre de Marca — mirror del web:
                  label="Nombre de Marca" + placeholder "Ingresa el nombre de la marca"
                  + required + minLength 2 + maxLength 100, con error inline. */}
              <Input
                label="Nombre de Marca"
                value={name}
                onChangeText={setName}
                onBlur={() => setTouched((current) => ({ ...current, name: true }))}
                placeholder="Ingresa el nombre de la marca"
                required
                maxLength={NAME_MAX_LENGTH}
                error={nameError ?? undefined}
                editable={!mutation.isPending}
              />
              {/* Descripción — mirror del web: textarea, rows=3,
                  placeholder "Ingresa una descripción (opcional)",
                  maxLength 1000. */}
              <Textarea
                label="Descripción"
                value={description}
                onChangeText={setDescription}
                placeholder="Ingresa una descripción (opcional)"
                rows={3}
                maxLength={DESCRIPTION_MAX_LENGTH}
                editable={!mutation.isPending}
              />
            </ScrollView>

            {/* Footer — border-top separador + botones alineados a la
                derecha (`justifyContent: 'flex-end'`) con gap entre
                ellos. Mirror exacto del footer del web. */}
            <View style={styles.footer}>
              <Button
                title="Cancelar"
                variant="outline"
                onPress={handleClose}
                disabled={mutation.isPending}
              />
              <Button
                title={mutation.isPending ? 'Creando…' : 'Crear Marca'}
                variant="primary"
                onPress={handleSubmit}
                loading={mutation.isPending}
              />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  cardWrapper: {
    width: '100%',
    maxWidth: CARD_MAX_WIDTH,
    maxHeight: '90%',
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.1,
    shadowRadius: 25,
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[3],
    backgroundColor: colors.card,
  },
  headerTitleWrap: {
    flex: 1,
    marginRight: spacing[2],
  },
  headerTitle: {
    fontSize: typography.fontSize.lg,
    fontFamily: typography.fontFamily,
    fontWeight: typography.fontWeight.semibold,
    color: colors.text.primary,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flexGrow: 0,
    flexShrink: 1,
  },
  bodyContent: {
    padding: spacing[4],
    gap: spacing[4],
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
    paddingBottom: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colorScales.gray[200],
    backgroundColor: colors.card,
  },
});
