import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  TextInput,
  Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/core/store/auth.store';
import { AuthService } from '@/core/auth/auth.service';
import { Icon } from '@/shared/components/icon/icon';
import { Button } from '@/shared/components/button/button';
import { Input } from '@/shared/components/input/input';
import { toastSuccess, toastError } from '@/shared/components/toast/toast.store';
import { colors, colorScales, spacing, typography, borderRadius } from '@/shared/theme';

export default function ProfileScreen() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showPasswordSection, setShowPasswordSection] = useState(false);

  const [firstName, setFirstName] = useState(user?.first_name || '');
  const [lastName, setLastName] = useState(user?.last_name || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [documentType, setDocumentType] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [country, setCountry] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [hasAddress, setHasAddress] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    if (loading) return;
    setLoading(true);
    try {
      const profile = await AuthService.getMe();
      setFirstName(profile.first_name || '');
      setLastName(profile.last_name || '');
      setPhone(profile.phone || '');
      setDocumentType(profile.document_type || '');
      setDocumentNumber(profile.document_number || '');
      if (profile.addresses && profile.addresses.length > 0) {
        const addr = profile.addresses[0];
        setAddressLine1(addr.address_line1 || '');
        setAddressLine2(addr.address_line2 || '');
        setCity(addr.city || '');
        setState(addr.state_province || '');
        setCountry(addr.country_code || '');
        setPostalCode(addr.postal_code || '');
        setHasAddress(true);
      }
    } catch (error: any) {
      toastError('Error cargando perfil');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      toastError('Nombre y apellido son requeridos');
      return;
    }
    setSaving(true);
    try {
      await AuthService.updateProfile({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: phone.trim(),
        document_type: documentType,
        document_number: documentNumber.trim(),
        address: {
          address_line_1: addressLine1.trim(),
          address_line_2: addressLine2.trim(),
          country,
          state,
          city: city.trim(),
          postal_code: postalCode.trim(),
        },
      });
      toastSuccess('Perfil guardado correctamente');
      setIsEditing(false);
      loadProfile();
    } catch (error: any) {
      toastError(error.message || 'Error guardando perfil');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      toastError('Completa todos los campos');
      return;
    }
    if (newPassword !== confirmPassword) {
      toastError('Las contraseñas no coinciden');
      return;
    }
    if (newPassword.length < 6) {
      toastError('La contraseña debe tener al menos 6 caracteres');
      return;
    }
    setSaving(true);
    try {
      await AuthService.changePassword(currentPassword, newPassword);
      toastSuccess('Contraseña actualizada exitosamente');
      setShowPasswordSection(false);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      toastError('Error actualizando contraseña. Verifica tu contraseña actual.');
    } finally {
      setSaving(false);
    }
  };

  const userInitials = user
    ? `${user.first_name?.[0] || ''}${user.last_name?.[0] || ''}`.toUpperCase() || 'U'
    : 'U';

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backButton}>
          <Icon name="arrow-left" size={20} color={colorScales.gray[700]} />
        </Pressable>
        <Text style={styles.headerTitle}>
          {isEditing ? 'Editar Perfil' : 'Mi Perfil'}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.content} contentContainerStyle={styles.contentInner}>
        {/* Profile Header — centered card */}
        <View style={styles.profileHeader}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{userInitials}</Text>
          </View>
          <Text style={styles.profileName}>{user?.first_name} {user?.last_name}</Text>
          <Text style={styles.profileEmail}>{user?.email}</Text>
        </View>

        {!isEditing ? (
          <>
            {/* Información Personal */}
            <Text style={styles.sectionHeader}>Información Personal</Text>
            <View style={styles.card}>
              <View style={styles.infoRow}>
                <Icon name="phone" size={18} color={colorScales.gray[400]} />
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>Teléfono</Text>
                  <Text style={styles.infoValue}>{user?.phone || 'No registrado'}</Text>
                </View>
              </View>
              <View style={styles.divider} />
              <View style={styles.infoRow}>
                <Icon name="file-text" size={18} color={colorScales.gray[400]} />
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>Documento</Text>
                  <Text style={styles.infoValue}>
                    {user?.document_type && user?.document_number
                      ? `${user.document_type.toUpperCase()} ${user.document_number}`
                      : 'No registrado'}
                  </Text>
                </View>
              </View>
              <View style={styles.divider} />
              <View style={styles.infoRow}>
                <Icon name="calendar" size={18} color={colorScales.gray[400]} />
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>Miembro desde</Text>
                  <Text style={styles.infoValue}>
                    {user?.created_at
                      ? new Date(user.created_at).toLocaleDateString('es-ES', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                        })
                      : 'No disponible'}
                  </Text>
                </View>
              </View>
            </View>

            {/* Dirección */}
            <Text style={styles.sectionHeader}>Dirección</Text>
            <View style={styles.card}>
              {hasAddress ? (
                <View style={styles.addressRow}>
                  <Icon name="map-pin" size={18} color={colorScales.gray[400]} />
                  <View style={styles.addressContent}>
                    <Text style={styles.addressLine}>{addressLine1}</Text>
                    {addressLine2 ? (
                      <Text style={styles.addressLine2}>{addressLine2}</Text>
                    ) : null}
                    <Text style={styles.addressCity}>
                      {city}{state ? `, ${state}` : ''}
                    </Text>
                    <Text style={styles.addressCountry}>
                      {country}{postalCode ? ` · ${postalCode}` : ''}
                    </Text>
                  </View>
                </View>
              ) : (
                <View style={styles.noAddress}>
                  <Icon name="map-pin" size={24} color={colorScales.gray[300]} />
                  <Text style={styles.noAddressText}>No hay dirección registrada</Text>
                  <Pressable onPress={() => setIsEditing(true)}>
                    <Text style={styles.addAddressLink}>Agregar dirección</Text>
                  </Pressable>
                </View>
              )}
            </View>

            {/* Cuenta */}
            <Text style={styles.sectionHeader}>Cuenta</Text>
            <View style={styles.card}>
              <View style={styles.infoRow}>
                <Icon name="user" size={18} color={colorScales.gray[400]} />
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>Usuario</Text>
                  <Text style={styles.infoValue}>{user?.username || user?.email}</Text>
                </View>
              </View>
              <View style={styles.divider} />
              <Pressable
                onPress={() => setShowPasswordSection(!showPasswordSection)}
                style={styles.passwordTrigger}
              >
                <Icon name="lock" size={18} color={colors.primary} />
                <Text style={styles.passwordTriggerText}>
                  {showPasswordSection ? 'Cancelar cambio' : 'Cambiar contraseña'}
                </Text>
              </Pressable>

              {showPasswordSection && (
                <View style={styles.passwordForm}>
                  <Input
                    label="Contraseña Actual"
                    value={currentPassword}
                    onChangeText={setCurrentPassword}
                    secureTextEntry
                    placeholder="••••••"
                  />
                  <Input
                    label="Nueva Contraseña"
                    value={newPassword}
                    onChangeText={setNewPassword}
                    secureTextEntry
                    placeholder="••••••"
                  />
                  <Input
                    label="Confirmar Contraseña"
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    secureTextEntry
                    placeholder="••••••"
                  />
                  <Button
                    title="Actualizar"
                    onPress={handleChangePassword}
                    loading={saving}
                    style={{ marginTop: spacing[3] }}
                  />
                </View>
              )}
            </View>

            <Button
              title="Editar Perfil"
              variant="primary"
              onPress={() => setIsEditing(true)}
              style={styles.editButton}
            />
          </>
        ) : (
          <>
            {/* Edit Form */}
            <Text style={styles.sectionHeader}>Información Personal</Text>
            <View style={styles.card}>
              <Input
                label="Nombre"
                value={firstName}
                onChangeText={setFirstName}
                placeholder="Tu nombre"
              />
              <Input
                label="Apellido"
                value={lastName}
                onChangeText={setLastName}
                placeholder="Tu apellido"
              />
              <Input
                label="Email"
                value={user?.email || ''}
                editable={false}
                style={{ opacity: 0.6 }}
              />
              <Input
                label="Teléfono"
                value={phone}
                onChangeText={setPhone}
                placeholder="+57 300 123 4567"
                keyboardType="phone-pad"
              />
            </View>

            <Text style={styles.sectionHeader}>Dirección</Text>
            <View style={styles.card}>
              <Input
                label="Dirección (Calle y Número)"
                value={addressLine1}
                onChangeText={setAddressLine1}
                placeholder="Calle Principal 123"
              />
              <Input
                label="Detalles adicionales"
                value={addressLine2}
                onChangeText={setAddressLine2}
                placeholder="Apto 4B"
              />
              <Input
                label="Ciudad"
                value={city}
                onChangeText={setCity}
                placeholder="Bogotá"
              />
              <Input
                label="Departamento"
                value={state}
                onChangeText={setState}
                placeholder="Cundinamarca"
              />
              <Input
                label="País"
                value={country}
                onChangeText={setCountry}
                placeholder="CO"
              />
              <Input
                label="Código Postal"
                value={postalCode}
                onChangeText={setPostalCode}
                placeholder="00000"
              />
            </View>

            <View style={styles.buttonRow}>
              <Button
                title="Cancelar"
                variant="outline"
                onPress={() => {
                  setIsEditing(false);
                  loadProfile();
                }}
                style={styles.button}
              />
              <Button
                title="Guardar Cambios"
                variant="primary"
                onPress={handleSaveProfile}
                loading={saving}
                style={styles.button}
              />
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colorScales.gray[100],
    backgroundColor: colors.background,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  content: {
    flex: 1,
  },
  contentInner: {
    padding: spacing[4],
    paddingBottom: spacing[8],
  },
  profileHeader: {
    alignItems: 'center',
    paddingTop: spacing[2],
    paddingBottom: spacing[5],
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 12,
    backgroundColor: colorScales.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[3],
    borderWidth: 2,
    borderColor: colorScales.gray[200],
    overflow: 'hidden',
  },
  avatarText: {
    fontSize: typography.fontSize['2xl'],
    fontWeight: typography.fontWeight.bold as any,
    fontFamily: typography.fontFamily,
    color: colors.primary,
  },
  profileName: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  profileEmail: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  sectionHeader: {
    fontSize: 11,
    fontWeight: typography.fontWeight.semibold as any,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[400],
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingHorizontal: spacing[1],
    marginBottom: spacing[2],
    marginTop: spacing[4],
  },
  card: {
    backgroundColor: colorScales.gray[50],
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colorScales.gray[100],
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  infoContent: {
    flex: 1,
  },
  infoLabel: {
    fontSize: 11,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[400],
    lineHeight: 14,
  },
  infoValue: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  divider: {
    height: 1,
    backgroundColor: colorScales.gray[100],
  },
  addressRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  addressContent: {
    flex: 1,
  },
  addressLine: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[900],
  },
  addressLine2: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[500],
  },
  addressCity: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[400],
    marginTop: spacing[1],
  },
  addressCountry: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[400],
  },
  noAddress: {
    alignItems: 'center',
    paddingVertical: spacing[6],
    paddingHorizontal: spacing[4],
  },
  noAddressText: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily,
    color: colorScales.gray[400],
    marginBottom: spacing[2],
  },
  addAddressLink: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium as any,
    fontFamily: typography.fontFamily,
    color: colors.primary,
  },
  passwordTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  passwordTriggerText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium as any,
    fontFamily: typography.fontFamily,
    color: colors.primary,
  },
  passwordForm: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
    gap: spacing[3],
  },
  editButton: {
    marginTop: spacing[4],
  },
  buttonRow: {
    flexDirection: 'row',
    gap: spacing[3],
    marginTop: spacing[4],
  },
  button: {
    flex: 1,
  },
});
