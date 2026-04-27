import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useRouter, Link } from 'expo-router';
import { AuthService } from '@/core/auth/auth.service';
import { useAuthStore } from '@/core/store/auth.store';
import { isValidEmail } from '@/core/utils/validators';
import { colors, authStyles as s } from '@/shared/styles/auth.styles';
import { Icon } from '@/shared/components/icon/icon';

export default function RegisterScreen() {
  const router = useRouter();
  const { setUser, setToken, setRefreshToken } = useAuthStore();
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
      setUser(response.user);
      setToken(response.token);
      setRefreshToken(response.refreshToken);
      const roles = response.user.roles || [];
      if (roles.includes('super_admin')) {
        router.replace('/(super-admin)/dashboard');
      } else if (roles.includes('organization_admin')) {
        router.replace('/(org-admin)/dashboard');
      } else {
        router.replace('/(store-admin)/dashboard');
      }
    } catch (err: unknown) {
      const message =
        (err as any)?.response?.data?.message ||
        (err as any)?.message ||
        'Error al crear la cuenta. Intenta de nuevo.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={s.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={s.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo */}
        <View style={s.logoContainer}>
          <Image
            source={require('@/assets/vlogo.png')}
            style={{ width: 64, height: 64, resizeMode: 'contain' }}
          />
          <Text style={s.brandText}>Vendix</Text>
        </View>

        {/* Title */}
        <View style={s.titleContainer}>
          <Text style={s.title}>Crear tu organización</Text>
          <Text style={s.subtitle}>Comienza tu viaje empresarial</Text>
        </View>

        {/* Form Card */}
        <View style={[s.card, { gap: 16 }]}>
          {error && (
            <View style={s.errorBox}>
              <Text style={s.errorText}>{error}</Text>
            </View>
          )}

          <InputField
            label="NOMBRE DE LA ORGANIZACIÓN"
            placeholder="Mi Empresa S.A.S"
            value={orgName}
            onChangeText={setOrgName}
            editable={!isLoading}
          />

          <InputField
            label="NOMBRE"
            placeholder="Juan"
            value={firstName}
            onChangeText={setFirstName}
            editable={!isLoading}
          />

          <InputField
            label="APELLIDO"
            placeholder="Pérez"
            value={lastName}
            onChangeText={setLastName}
            editable={!isLoading}
          />

          <InputField
            label="EMAIL"
            placeholder="usuario@email.com"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isLoading}
          />

          <InputField
            label="TELÉFONO"
            placeholder="+57 123 456 7890"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            helperText="Opcional"
            editable={!isLoading}
          />

          <InputField
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
            style={[s.button, isLoading && s.buttonDisabled]}
            onPress={handleRegister}
            disabled={isLoading}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={s.buttonText}>Crear cuenta</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Login Link */}
        <View style={s.registerRow}>
          <Text style={s.registerText}>¿Ya tienes cuenta? </Text>
          <Link href="/(auth)/login" asChild>
            <TouchableOpacity>
              <Text style={s.registerLinkText}>Inicia sesión</Text>
            </TouchableOpacity>
          </Link>
        </View>

        {/* Back Link */}
        <View style={s.backLinkContainer}>
          <Link href="/" asChild>
            <TouchableOpacity>
              <Text style={s.backLinkText}>← Volver al inicio</Text>
            </TouchableOpacity>
          </Link>
        </View>

        {/* Footer */}
        <View style={s.footer}>
          <Text style={s.footerText}>Acceso a Vendix Platform</Text>
          <Text style={s.footerText}>Powered by Vendix</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function InputField({
  label,
  placeholder,
  value,
  onChangeText,
  secureTextEntry,
  keyboardType,
  autoCapitalize,
  autoCorrect,
  editable,
  helperText,
  rightIcon,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  secureTextEntry?: boolean;
  keyboardType?: 'email-address' | 'phone-pad' | 'default';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoCorrect?: boolean;
  editable?: boolean;
  helperText?: string;
  rightIcon?: React.ReactNode;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <View>
      <Text style={s.inputLabel}>{label}</Text>
      <View
        style={[
          s.inputContainer,
          focused && s.inputContainerFocused,
        ]}
      >
        <TextInput
          style={s.input}
          placeholder={placeholder}
          placeholderTextColor={colors.text.muted}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={autoCorrect}
          editable={editable}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {rightIcon && <View style={s.inputRightIcon}>{rightIcon}</View>}
      </View>
      {helperText && (
        <Text style={s.helperText}>{helperText}</Text>
      )}
    </View>
  );
}
