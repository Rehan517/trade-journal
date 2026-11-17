// Root ESLint flat config. ESLint 10 resolves config per file from the
// nearest eslint.config.*, so apps/web keeps using its own config and this
// one covers everything else (apps/api, packages/*, infra).
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['**/dist/', '**/coverage/', '**/cdk.out/', '**/*.d.ts']),
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.node,
      parserOptions: { tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    // infra is a CommonJS package (no "type": "module").
    files: ['**/*.cjs', 'infra/**/*.js'],
    languageOptions: { sourceType: 'commonjs' },
  },
  prettier,
]);
