/**
 * @jest Configuracion optimizada para PowerShell 5.1 en Windows.
 * 
 * Estrategia de rendimiento:
 * - Workers limitados para evitar saturar RAM
 * - Timeouts razonables
 * - Reporters ligeros
 * - Git hooks desactivados
 * - Cache desactivada en CI
 */

module.exports = {
  // -- Preset y entorno --------------------------------------------------------
  preset: 'ts-jest',
  testEnvironment: 'node',

  // -- Patrones de busqueda ----------------------------------------------------
  // Tests en tests/**. Se quito `roots: ['<rootDir>/tests']`: ademas de ser
  // redundante con testMatch, impedia que Jest instrumentara los archivos no
  // importados por ningun test (collectCoverageFrom quedaba reducido a lo que los
  // tests cargaban, ocultando el 87% sin cobertura).
  testMatch: ['**/tests/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/legacy/'],
  moduleFileExtensions: ['ts', 'js', 'json'],

  // -- Paralelismo (CRITICO en Windows con 16GB RAM) --------------------------
  // Limita workers para evitar saturacion de memoria.
  // En Windows, 2 workers suele ser seguro con 16GB.
  // Si ves reinicios, baja a 1 o usa --runInBand.
  maxWorkers: 2,

  // -- Timeouts ----------------------------------------------------------------
  testTimeout: 30000,        // 30s por test (default 5000)
  slowTestThreshold: 10000,  // Marcar como lento >10s

  // -- Cache y deteccion de cambios -------------------------------------------
  // Desactivar cache si hay problemas de memoria
  cache: !process.env.NO_CACHE,

  // -- Reporters ---------------------------------------------------------------
  // Se elimino el 'jest-reflection-reporter': invocaba scripts/reflection-commit-bridge.mjs,
  // que importa ../src/reflection/reflection-engine.js (no existe: src/ no tiene .js) y
  // fallaba en silencio (ERR_MODULE_NOT_FOUND) en cada suite fallida.
  reporters: [process.env.VERBOSE ? ['default', { verbose: true }] : ['default', { verbose: false }]],

  // -- Coverage ----------------------------------------------------------------
  collectCoverage: !!process.env.COLLECT_COVERAGE,
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'lcov'],
  collectCoverageFrom: [
    'src/**/*.ts',
    // El entrypoint es el 100% de la superficie publicada: antes quedaba fuera
    // de la medicion y el numero alto correspondia a codigo inalcanzable.
    'bin/**/*.ts',
    '!**/*.d.ts',
    '!legacy/**',
  ],
  // Umbral de ratchet. Los valores de partida son la cobertura real medida el
  // 2026-10-09 (20,23% stmts / 15,49% branches / 19,82% funcs / 21,17% lines) una
  // vez corregido `roots`: el 58% anterior medía codigo inalcanzable y archivos
  // que los tests importaban, no la superficie publicada.
  // Objetivo: 60% de los modulos vivos (bin/cli.ts incluido) y subir el umbral en
  // cada PR que agregue cobertura.
  coverageThreshold: {
    global: {
      statements: 19,
      branches: 14,
      functions: 18,
      lines: 20,
    },
  },

  // -- Mocks y setup -----------------------------------------------------------
  // No usar setupFiles para no agregar overhead
  clearMocks: true,
  resetMocks: false,
  restoreMocks: false,

  // -- Transform ---------------------------------------------------------------
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
      },
    ],
  },

  // -- Git hooks ---------------------------------------------------------------
  // No detectar cambios en git (evita overhead)
  watchPathIgnorePatterns: [
    'node_modules',
    'dist',
    'coverage',
  ],

  // -- Module name mapper ------------------------------------------------------
  // chalk v5 is pure ESM; Jest runs CJS. Use a passthrough mock.
  moduleNameMapper: {
    '^chalk$': '<rootDir>/tests/__mocks__/chalk.js',
  },
};
