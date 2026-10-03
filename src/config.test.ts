import { describe, expect, it } from '@jest/globals';
import { loadConfig } from './config.ts';

describe('loadConfig', () => {
	it('Falls back to sensible defaults when no environment variables are set.', () => {
		expect(loadConfig({})).toEqual({
			port: 3000,
			host: '0.0.0.0',
			corsOrigins: [],
		});
	});

	it('Treats blank PORT and HOST values as unset.', () => {
		expect(loadConfig({ PORT: '  ', HOST: '  ' })).toMatchObject({
			port: 3000,
			host: '0.0.0.0',
		});
	});

	it('Reads the port and host from the environment.', () => {
		expect(loadConfig({ PORT: '8080', HOST: '127.0.0.1' })).toMatchObject({
			port: 8080,
			host: '127.0.0.1',
		});
	});

	it('Rejects a PORT that is not a valid TCP port number.', () => {
		expect(() => loadConfig({ PORT: 'abc' })).toThrow(/Invalid PORT/);
		expect(() => loadConfig({ PORT: '70000' })).toThrow(/Invalid PORT/);
		expect(() => loadConfig({ PORT: '3.5' })).toThrow(/Invalid PORT/);
	});

	it('Reads from process.env when no environment object is given.', () => {
		const original = process.env.PORT;
		process.env.PORT = '4242';

		try {
			expect(loadConfig().port).toBe(4242);
		} finally {
			if (original === undefined) {
				delete process.env.PORT;
			} else {
				process.env.PORT = original;
			}
		}
	});

	it('Splits CORS_ORIGIN on commas, trimming whitespace and dropping empty entries.', () => {
		expect(loadConfig({ CORS_ORIGIN: ' http://localhost:5173 , ,https://ti.example.com' }).corsOrigins).toEqual([
			'http://localhost:5173',
			'https://ti.example.com',
		]);
	});
});
