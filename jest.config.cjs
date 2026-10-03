// Jest configuration — https://jestjs.io/docs/configuration
module.exports = {
	coverageReporters: ['lcov', 'text-summary'],
	collectCoverageFrom: ['src/**/*.ts', '!src/serve.ts'],
	coverageThreshold: {
		global: {
			statements: 100,
			branches: 100,
			functions: 100,
			lines: 100,
		},
	},
	extensionsToTreatAsEsm: ['.ts'],
	moduleNameMapper: {
		'^(\\.{1,2}/.*)\\.js$': '$1',
	},
	preset: 'ts-jest/presets/default-esm',
	setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
	testEnvironment: 'node',
	testMatch: ['**/*.test.ts'],
	transform: {
		'^.+\\.tsx?$': [
			'ts-jest',
			{
				useESM: true,
				tsconfig: {
					target: 'ESNext',
					module: 'ESNext',
					moduleResolution: 'node',
					allowImportingTsExtensions: true,
					esModuleInterop: true,
					// Jest runs the transformed output as CommonJS; these only matter for Node's native TS loader.
					verbatimModuleSyntax: false,
					noEmit: true,
				},
			},
		],
	},
};
