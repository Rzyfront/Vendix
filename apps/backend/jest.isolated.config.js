// CI config for the specs whose imports reach the full Prisma client types:
// type-checking them per file exhausts the heap. Types stay covered by
// `buildcheck:types` in the Backend Build job.
const { jest: base } = require('./package.json');

module.exports = {
  ...base,
  transform: { '^.+\\.(t|j)s$': ['ts-jest', { isolatedModules: true }] },
};
