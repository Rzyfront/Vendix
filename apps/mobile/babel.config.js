module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated 4 + Worklets 0.5 requiere el plugin de worklets.
    // Sin esto, cualquier `useSharedValue`/`withSpring` lanza error en runtime.
    // Debe ser el ÚLTIMO plugin de la lista.
    plugins: ['react-native-worklets/plugin'],
  };
};
