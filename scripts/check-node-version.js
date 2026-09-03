#!/usr/bin/env node
/**
 * Guard de version de Node para el frontend nativo.
 *
 * Angular 20 soporta ^20.19 || ^22.12 || ^24. En este equipo Homebrew instala
 * su propio node en /opt/homebrew/bin, que GANA en el PATH sobre el de nvm:
 * `nvm use 22` responde "Now using node v22.22.0" y `node -v` sigue devolviendo
 * v26. Sin este guard, `ng serve` arranca con una version fuera de matriz y
 * falla de formas que no apuntan a su causa.
 */
const SUPPORTED = [20, 22, 24];
const [major, minor] = process.versions.node.split('.').map(Number);

const ok =
  SUPPORTED.includes(major) &&
  !(major === 20 && minor < 19) &&
  !(major === 22 && minor < 12);

if (ok) process.exit(0);

console.error(`
  Node ${process.versions.node} no esta en la matriz de Angular 20.
  Soportado: 20.19+, 22.12+ o 24.x     (este repo fija 22 en .nvmrc)

  Ejecutable en uso: ${process.execPath}

  Si ya corriste "nvm use" y sigue saliendo esta version, es que el node de
  Homebrew va antes en tu PATH. Antepone el de nvm en la misma terminal:

      nvm use
      export PATH="$NVM_BIN:$PATH"
      node -v          # debe decir v22.x
`);
process.exit(1);
