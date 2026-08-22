/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  /*
   * Lo mismo que declara `react-native/jest-preset`: sin la plataforma por
   * defecto y su resolver, `require('react-native/Libraries/Utilities/Platform')`
   * no encuentra `Platform.ios.js` y `Platform` llega `undefined`. Eso tumbaba
   * a `pos-ticket.service.spec.ts` con «Cannot read properties of undefined
   * (reading 'OS')» dentro de `expo-modules-core`, otra vez sin ejecutar un
   * solo test.
   */
  haste: {
    defaultPlatform: 'ios',
    platforms: ['android', 'ios', 'native'],
  },
  resolver: require.resolve('react-native/jest/resolver.js'),
  /*
   * El setup oficial de RN: instala los mocks de `NativeModules` /
   * `TurboModuleRegistry`. Sin él, cualquier import que llegue a un módulo
   * nativo (AsyncStorage, expo-print) muere con «__fbBatchedBridgeConfig is
   * not set, cannot invoke native modules» antes del primer test.
   */
  setupFiles: [require.resolve('react-native/jest/setup.js')],
  /*
   * Las variantes `.web` van PRIMERO: son las implementaciones en JavaScript
   * puro, las únicas que pueden correr bajo `testEnvironment: 'node'`. Las
   * variantes nativas de Expo son no-ops que delegan en el runtime del
   * dispositivo: `expo-modules-core/src/polyfill/index.ts` es literalmente
   * `// noop`, así que `globalThis.expo` nunca se instalaba y `expo-print`
   * moría con «Cannot read properties of undefined (reading 'EventEmitter')».
   * `index.web.ts` sí instala ese global.
   *
   * Los ficheros de React Native siguen resolviéndose por `haste` (`.ios`,
   * `.native`), que se intenta antes que esta lista.
   */
  moduleFileExtensions: ['web.ts', 'web.tsx', 'web.js', 'ts', 'tsx', 'js', 'jsx', 'json'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    /*
     * El mock OFICIAL que publica el propio paquete. AsyncStorage exige el
     * módulo nativo al importarse (`RCTAsyncStorage`) y lo alcanza cualquier
     * spec que toque `core/store/auth.store.ts`, aunque no pruebe nada de
     * almacenamiento.
     */
    '^@react-native-async-storage/async-storage$':
      '<rootDir>/../../../node_modules/@react-native-async-storage/async-storage/jest/async-storage-mock.js',
  },
  /*
   * `__DEV__` es un global que Metro inyecta y que `react-native/index.js`
   * lee al cargarse. Sin él, cualquier spec que roce un módulo de RN — aunque
   * sólo sea de rebote, por un barrel — muere con «ReferenceError: __DEV__ is
   * not defined» ANTES de ejecutar un solo test. `react-native/jest/setup.js`
   * también lo define, pero corre DESPUÉS de que jest evalúe el módulo de
   * configuración, así que se declara también aquí.
   */
  globals: {
    __DEV__: true,
  },
  transform: {
    /*
     * `react-native` y los paquetes de Expo se publican en Flow/ESM sin
     * transpilar y NO se pueden pasar por ts-jest: `react-native/index.js`
     * abre con `import typeof * as ReactNativePublicAPI from './index.js.flow'`
     * (sintaxis Flow), que TypeScript no sabe borrar, y el resultado revienta
     * con «ReferenceError: ReactNativePublicAPI is not defined». Se transpilan
     * con babel + el preset oficial de React Native, que sí entiende Flow.
     *
     * Este patrón va PRIMERO a propósito: jest usa el primer transform cuya
     * expresión casa con la ruta.
     */
    'node_modules[\\\\/].+\\.[cm]?[jt]sx?$': [
      'babel-jest',
      {
        babelrc: false,
        configFile: false,
        presets: ['@react-native/babel-preset'],
      },
    ],
    /*
     * El patrón cubre `.tsx`/`.jsx` a propósito.
     *
     * Mientras fue `^.+\.(t|j)s$`, cualquier spec que alcanzara un `.tsx` —
     * aunque fuera de rebote, vía un barrel como `shared/theme/index.ts` —
     * moría con «SyntaxError: Unexpected token '<'» y jest lo reportaba como
     * «Test suite failed to run»: CERO tests fallidos. Era un verde falso:
     * `sales-views.spec.ts` y `pos-ticket.service.spec.ts` ni arrancaban y la
     * línea `Tests:` seguía diciendo que todo pasaba. Al leer un resultado hay
     * que mirar `Test Suites:`, no sólo `Tests:`.
     */
    '^.+\\.(t|j)sx?$': [
      'ts-jest',
      {
        /*
         * Objeto en vez de ruta: ts-jest lo fusiona sobre el tsconfig más
         * cercano (apps/mobile/tsconfig.json) y así se puede sobrescribir sólo
         * lo que el entorno de test necesita. `expo/tsconfig.base` declara
         * `jsx: react-native` y `module: preserve`, que son correctos para
         * Metro pero imposibles para jest: dejarían el JSX y los `import` sin
         * transformar. Aquí se compila a `react-jsx` + CommonJS.
         */
        tsconfig: {
          jsx: 'react-jsx',
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
          allowJs: true,
          isolatedModules: true,
        },
      },
    ],
  },
  /*
   * Los paquetes de Expo se publican como ESM sin transpilar. Con el
   * `transformIgnorePatterns` por defecto («/node_modules/») jest los cargaba
   * crudos y `pos-ticket.service.spec.ts` moría en el `import` de
   * `expo-print`, otra vez como «Test suite failed to run». Se dejan pasar por
   * el transform sólo los paquetes del ecosistema Expo/React Native.
   */
  transformIgnorePatterns: [
    'node_modules/(?!(?:.pnpm/)?(?:jest-)?(?:@react-native|react-native|react-clone-referenced-element|expo|expo-.*|@expo|@expo-google-fonts|react-navigation|@react-navigation|@unimodules|unimodules|sentry-expo|native-base|@shopify/react-native-skia)/)',
  ],
  collectCoverageFrom: ['core/api/**/*.ts'],
  coverageDirectory: '../coverage',
};
