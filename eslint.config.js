import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'coverage', '.data', 'public'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['core/**/*.ts'],
    languageOptions: { globals: { ...globals['shared-node-browser'] } },
    rules: {
      // core/ se ejecuta igual en el navegador y en Actions: nada de DOM ni de Node aquí.
      'no-restricted-globals': ['error', 'window', 'document', 'localStorage', 'indexedDB', 'process'],
      'no-restricted-imports': ['error', { patterns: ['node:*', 'react', 'dexie', '@/*'] }],
    },
  },
  {
    files: ['tools/**/*.ts', 'vite.config.ts', 'vitest.config.ts', 'eslint.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
