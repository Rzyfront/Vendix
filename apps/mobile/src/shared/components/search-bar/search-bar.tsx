import { useState } from 'react';
import { View, TextInput, Pressable, Text, type TextInputProps } from 'react-native';

interface SearchBarProps extends Omit<TextInputProps, 'className'> {
  onSubmit?: (value: string) => void;
  onClear?: () => void;
  containerClassName?: string;
}

export function SearchBar({
  value,
  onSubmit,
  onClear,
  placeholder = 'Search...',
  containerClassName = '',
  ...props
}: SearchBarProps) {
  const [localValue, setLocalValue] = useState(value || '');

  const handleClear = () => {
    setLocalValue('');
    onClear?.();
  };

  const handleSubmit = () => {
    onSubmit?.(localValue);
  };

  return (
    <View className={`flex-row items-center bg-gray-100 rounded-lg px-3 h-11 ${containerClassName}`}>
      <Text className="text-gray-400 mr-2 text-lg">🔍</Text>
      <TextInput
        className="flex-1 text-gray-900 text-base"
        value={localValue}
        onChangeText={setLocalValue}
        onSubmitEditing={handleSubmit}
        placeholder={placeholder}
        placeholderTextColor="#9ca3af"
        returnKeyType="search"
        {...props}
      />
      {localValue.length > 0 && (
        <Pressable onPress={handleClear} hitSlop={8}>
          <Text className="text-gray-400 text-lg">×</Text>
        </Pressable>
      )}
    </View>
  );
}
