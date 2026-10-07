const { defineConfig } = require('eslint/config');
const expo = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expo,
  {
    ignores: ['dist/**', '.expo/**', '.playground-dist/**', 'test-results/**', 'playground-test-results/**', 'playwright-report/**'],
  },
]);
