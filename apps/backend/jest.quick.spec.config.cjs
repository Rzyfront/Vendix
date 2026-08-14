// Local Jest config — only used to run the QUI-558 unit specs without
// dragging the whole backend graph (which has pre-existing missing
// dev-deps like `uuid`) through ts-jest. Production test command
// (`npm test`) keeps using the package.json `jest` block unchanged.
//
// Usage:
//   ../../node_modules/.bin/jest --config jest.quick.spec.config.cjs \
//     src/domains/store/memberships/member-bulk-scanner.service.spec.ts

module.exports = {
  rootDir: 'src',
  testEnvironment: 'node',
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': [
      'ts-jest',
      { isolatedModules: true, diagnostics: false },
    ],
  },
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/$1',
    '^@common/(.*)$': '<rootDir>/common/$1',
    // Stub `uuid` so unrelated services with pre-existing dev-dep
    // gaps can still be imported transitively.
    '^uuid$': '<rootDir>/__mocks__/uuid.ts',
  },
};
