import { View, Text, Image, type ViewProps } from 'react-native';

type AvatarSize = 'sm' | 'md' | 'lg';

interface AvatarProps extends ViewProps {
  source?: string | null;
  name?: string;
  size?: AvatarSize;
}

const sizeClasses: Record<AvatarSize, string> = {
  sm: 'w-8 h-8',
  md: 'w-10 h-10',
  lg: 'w-12 h-12',
};

const textSizeClasses: Record<AvatarSize, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
};

function getInitials(name: string): string {
  const words = name.trim().split(' ');
  if (words.length === 1) {
    return words[0].substring(0, 2).toUpperCase();
  }
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function getColorFromName(name: string): string {
  const colors = [
    'bg-red-500',
    'bg-orange-500',
    'bg-amber-500',
    'bg-yellow-500',
    'bg-lime-500',
    'bg-green-500',
    'bg-emerald-500',
    'bg-teal-500',
    'bg-cyan-500',
    'bg-sky-500',
    'bg-blue-500',
    'bg-indigo-500',
    'bg-violet-500',
    'bg-purple-500',
    'bg-fuchsia-500',
    'bg-pink-500',
    'bg-rose-500',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

export function Avatar({ source, name = '', size = 'md', className = '', ...props }: AvatarProps) {
  const initials = getInitials(name || '?');
  const bgColor = getColorFromName(name || '');

  if (source) {
    return (
      <Image
        source={{ uri: source }}
        className={`rounded-full ${sizeClasses[size]} ${className}`}
        {...props}
      />
    );
  }

  return (
    <View
      className={`
        rounded-full items-center justify-center
        ${sizeClasses[size]}
        ${bgColor}
        ${className}
      `}
      {...props}
    >
      <Text className={`font-medium text-white ${textSizeClasses[size]}`}>
        {initials}
      </Text>
    </View>
  );
}
