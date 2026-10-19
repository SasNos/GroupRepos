import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'coverage/', 'dist/'] },
  js.configs.recommended,
  {
    files: ['content.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser, chrome: 'readonly' } },
  },
  {
    files: ['tests/**/*.js', '*.config.js'],
    languageOptions: { globals: { ...globals.browser, ...globals.node, chrome: 'readonly' } },
  },
  prettier,
];
