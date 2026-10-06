import { describe, expect, it } from '@jest/globals';
import { loadConfig } from './config.ts';

describe('loadConfig', () => {
	it('Falls back to sensible defaults when no environment variables are set.', () => {
		expect(loadConfig({})).toEqual({
			port: 3000,
			host: '0.0.0.0',
			corsOrigins: [],
			ollamaUrl: 'http://localhost:11434',
			ollamaModel: 'llama3.2:3b',
		});
	});

	it('Treats blank PORT, HOST, OLLAMA_URL and OLLAMA_MODEL values as unset.', () => {
		expect(loadConfig({ PORT: '  ', HOST: '  ', OLLAMA_URL: '  ', OLLAMA_MODEL: '  ' })).toMatchObject({
			port: 3000,
			host: '0.0.0.0',
			ollamaUrl: 'http://localhost:11434',
			ollamaModel: 'llama3.2:3b',
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

	it('Reads the Ollama server URL from the environment, dropping any trailing slash.', () => {
		expect(loadConfig({ OLLAMA_URL: 'http://ollama:11434/' }).ollamaUrl).toBe('http://ollama:11434');
		expect(loadConfig({ OLLAMA_URL: ' https://nas.local:11434 ' }).ollamaUrl).toBe('https://nas.local:11434');
	});

	it('Rejects an OLLAMA_URL that is not an absolute http(s) URL.', () => {
		expect(() => loadConfig({ OLLAMA_URL: 'ollama:11434' })).toThrow(/Invalid OLLAMA_URL/);
		expect(() => loadConfig({ OLLAMA_URL: 'not a url' })).toThrow(/Invalid OLLAMA_URL/);
		expect(() => loadConfig({ OLLAMA_URL: 'ftp://ollama:11434' })).toThrow(/Invalid OLLAMA_URL/);
	});

	it('Reads the Ollama model name from the environment.', () => {
		expect(loadConfig({ OLLAMA_MODEL: ' qwen2.5:3b ' }).ollamaModel).toBe('qwen2.5:3b');
	});
});
