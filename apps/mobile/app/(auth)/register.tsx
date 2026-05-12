import { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from 'react-native';
import { useRouter, Link } from 'expo-router';
import { AuthService } from '@/core/auth/auth.service';
import { isValidEmail } from '@/core/utils/validators';
import { colors } from '@/shared/theme';
import { Input } from '@/shared/components/input/input';
import { Icon } from '@/shared/components/icon/icon';

const styles = {
  screen: { flex: 1, backgroundColor: colors.background },
  scrollContent: { flexGrow: 1, justifyContent: 'center' as const, paddingHorizontal: 32, paddingVertical: 48 },
  logoContainer: { alignItems: 'center' as const, marginBottom: 32 },
  brandText: { fontSize: 20, fontWeight: '600' as const, color: colors.text.primary },
  titleContainer: { alignItems: 'center' as const, marginBottom: 24 },
  title: { fontSize: 26, fontWeight: '700' as const, color: colors.text.primary },
  subtitle: { fontSize: 14, color: colors.text.secondary, marginTop: 4, textAlign: 'center' as const },
  card: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.cardBorder, padding: 24, gap: 16 },
  errorBox: { backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', borderRadius: 8, padding: 12 },
  errorText: { fontSize: 14, color: colors.error, textAlign: 'center' as const },
  button: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center' as const, justifyContent: 'center' as const },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontSize: 14, fontWeight: '600' as const, color: '#FFFFFF' },
  linkContainer: { alignItems: 'center' as const, marginTop: 16 },
  linkText: { fontSize: 14, fontWeight: '500' as const, color: colors.primary },
  backLinkContainer: { alignItems: 'center' as const, marginTop: 24 },
  backLinkText: { fontSize: 14, fontWeight: '500' as const, color: colors.text.primary },
  registerRow: { flexDirection: 'row' as const, justifyContent: 'center' as const, marginTop: 16 },
  registerText: { fontSize: 13, color: colors.text.secondary },
  registerLinkText: { fontSize: 13, fontWeight: '600' as const, color: colors.primary },
  footer: { alignItems: 'center' as const, marginTop: 32, gap: 4 },
  footerText: { fontSize: 12, color: colors.text.muted },
};

export default function RegisterScreen() {
  const router = useRouter();
  const [orgName, setOrgName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRegister = async () => {
    setError(null);
    if (!orgName.trim()) {
      setError('Por favor ingresa el nombre de la organización');
      return;
    }
    if (!firstName.trim()) {
      setError('Por favor ingresa tu nombre');
      return;
    }
    if (!isValidEmail(email)) {
      setError('Por favor ingresa un correo electrónico válido');
      return;
    }
    if (password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres');
      return;
    }
    setIsLoading(true);
    try {
      const response = await AuthService.register({
        organizationName: orgName,
        firstName,
        lastName,
        email,
        phone: phone || undefined,
        password,
      });
      const appType = response.user_settings?.app_type;
      if (appType === 'VENDIX_ADMIN') {
        router.replace('/(super-admin)/dashboard');
      } else if (appType === 'ORG_ADMIN') {
        router.replace('/(org-admin)/dashboard');
      } else {
        router.replace('/(store-admin)/dashboard');
      }
    } catch (err: unknown) {
      const resp = (err as any)?.response?.data;
      const raw = resp?.message || (err as any)?.message || 'Error al crear la cuenta. Intenta de nuevo.';
      const message = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.join(', ') : JSON.stringify(raw);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo */}
        <View style={styles.logoContainer}>
          <Image
            source={require('@/assets/vlogo.png')}
            style={{ width: 64, height: 64, resizeMode: 'contain' }}
          />
          <Text style={styles.brandText}>Vendix</Text>
        </View>

        {/* Title */}
        <View style={styles.titleContainer}>
          <Text style={styles.title}>Crear tu organización</Text>
          <Text style={styles.subtitle}>Comienza tu viaje empresarial</Text>
        </View>

        {/* Form Card */}
        <View style={styles.card}>
          {error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Input
            label="NOMBRE DE LA ORGANIZACIÓN"
            placeholder="Mi Empresa S.A.S"
            value={orgName}
            onChangeText={setOrgName}
            editable={!isLoading}
          />

          <Input
            label="NOMBRE"
            placeholder="Juan"
            value={firstName}
            onChangeText={setFirstName}
            editable={!isLoading}
          />

          <Input
            label="APELLIDO"
            placeholder="Pérez"
            value={lastName}
            onChangeText={setLastName}
            editable={!isLoading}
          />

          <Input
            label="EMAIL"
            placeholder="usuario@email.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isLoading}
          />

          <Input
            label="TELÉFONO"
            placeholder="+57 123 456 7890"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            helperText="Opcional"
            editable={!isLoading}
          />

          <Input
            label="CONTRASEÑA"
            placeholder="••••••••"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            helperText="Mín. 8 caracteres, 1 mayúscula y 1 especial"
            editable={!isLoading}
            rightIcon={
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                <Icon name={showPassword ? 'eye-off' : 'eye'} size={20} color={colors.text.muted} />
              </TouchableOpacity>
            }
          />

          <TouchableOpacity
            style={[styles.button, isLoading && styles.buttonDisabled]}
            onPress={handleRegister}
            disabled={isLoading}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.buttonText}>Crear cuenta</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Login Link */}
        <View style={styles.registerRow}>
          <Text style={styles.registerText}>¿Ya tienes cuenta? </Text>
          <Link href="/(auth)/login" asChild>
            <TouchableOpacity>
              <Text style={styles.registerLinkText}>Inicia sesión</Text>
            </TouchableOpacity>
          </Link>
        </View>

        {/* Back Link */}
        <View style={styles.backLinkContainer}>
          <Link href="/" asChild>
            <TouchableOpacity>
              <Text style={styles.backLinkText}>← Volver al inicio</Text>
            </TouchableOpacity>
          </Link>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Acceso a Vendix Platform</Text>
          <Text style={styles.footerText}>Powered by Vendix</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}