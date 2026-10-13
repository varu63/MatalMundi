import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: [
      '**/node_modules/**',
      'client/dist/**',
      'client/src/assets/**',
      'server/uploads/**',
      'vibe_images/**',
      '**/*.min.js',
    ],
  },

  // Client — browser ES modules with JSX.
  {
    files: ['client/src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // Client build config — Node ESM.
  {
    files: ['client/vite.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },

  // Server, test harness and root scripts — Node CommonJS.
  {
    files: ['server/src/**/*.js', 'server/tests/**/*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },

  // Jest globals for the server test suite.
  {
    files: ['server/tests/**/*.js'],
    languageOptions: {
      globals: { ...globals.jest },
    },
  },

  // Keep stylistic rules out of ESLint's way — Prettier owns formatting.
  prettier,
];
