import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Configuracion plana de ESLint para el camino vivo (bin/ + src/).
 * `legacy/` queda fuera: es codigo archivado que no se compila ni se testea.
 */
export default tseslint.config(
    {
        ignores: [
            'node_modules/**',
            'dist/**',
            'coverage/**',
            'legacy/**',
            'processed/**',
            'failed/**',
            'documentation/**',
            'docs/**',
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['**/*.ts', '**/*.js', '**/*.mjs'],
        rules: {
            // El proyecto usa `any` en las fronteras de I/O (JSON del modelo, argv,
            // require de paquetes CJS): se permite explicitamente, pero no en vano.
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': [
                'warn',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
            ],
            '@typescript-eslint/no-require-imports': 'off',
            // El saneador de terminal necesita matchear caracteres de control.
            'no-control-regex': 'off',
            'no-console': 'off',
            'no-empty': ['error', { allowEmptyCatch: true }],
            eqeqeq: ['error', 'smart'],
            'prefer-const': 'warn',
        },
    },
    {
        // El modulo de encoding trabaja, por definicion, con espacios irregulares
        // (NBSP, zero-width) y clases de caracteres con joiners: son datos, no bugs.
        files: ['src/shared/utils/encoding.ts'],
        rules: {
            'no-irregular-whitespace': 'off',
            'no-misleading-character-class': 'off',
        },
    },
);
