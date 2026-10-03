import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const jestGlobals = {
	describe: 'readonly',
	it: 'readonly',
	expect: 'readonly',
	jest: 'readonly',
	beforeAll: 'readonly',
	beforeEach: 'readonly',
	afterAll: 'readonly',
	afterEach: 'readonly',
};

export default [
	{
		ignores: ['coverage/**', 'node_modules/**'],
	},
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	{
		rules: {
			'multiline-comment-style': ['error', 'separate-lines', { checkJSDoc: true }],
		},
	},
	{
		files: ['**/*.ts'],
		languageOptions: {
			globals: globals.node,
		},
	},
	{
		files: ['**/*.test.ts'],
		languageOptions: {
			globals: jestGlobals,
		},
	},
	{
		files: ['**/*.cjs'],
		languageOptions: {
			globals: globals.node,
		},
	},
];
