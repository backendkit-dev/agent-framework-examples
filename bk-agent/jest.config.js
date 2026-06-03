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
  // Tests unitarios: cualquier test en tests/ que NO este en tests/integration/
  // Tests de integracion: tests/integration/**/*.test.ts
  // Para ejecutar solo unitarios: npx jest --testPathIgnorePatterns=integration
  // Para ejecutar solo integracion: npx jest tests/integration
  testMatch: ['**/tests/**/*.test.ts'],
  testPathIgnorePatterns: [],
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
  // Reporter por defecto (summary) + reflection reporter para acumular incidentes en test-domain
  reporters: [
    process.env.VERBOSE ? ['default', { verbose: true }] : ['default', { verbose: false }],
    '<rootDir>/scripts/jest-reflection-reporter.js',
  ],

  // -- Coverage ----------------------------------------------------------------
  collectCoverage: !!process.env.COLLECT_COVERAGE,
  coverageDirectory: 'coverage',
  coverageReporters: ['text-summary', 'lcov'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts',
    '!src/bin/**',
  ],

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

  // -- Roots -------------------------------------------------------------------
  roots: ['<rootDir>/tests'],
};
