import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['client/src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // Útiles para detectar bugs reales
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-constant-condition': 'warn',
      'no-unreachable': 'error',

      // Relajar reglas que generan mucho ruido sin valor
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-namespace': 'off',
      'no-empty': 'off',
      'no-useless-assignment': 'off',
    },
  },
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/*.js', '!eslint.config.js'],
  },
);
