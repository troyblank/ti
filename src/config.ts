import path from 'node:path';

export type Config = {
	port: number;
	host: string;
	corsOrigins: string[];
	ollamaUrl: string;
	ollamaModel: string;
	ollamaTimeoutMs: number;
	dataDir: string;
	maxPdfBytes: number;
};

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_OLLAMA_URL = 'http://localhost:11434';
const DEFAULT_OLLAMA_MODEL = 'llama3.2:3b';
// Under Node fetch's own 300s headers timeout, so TI's clearer 504 always fires first.
const DEFAULT_OLLAMA_TIMEOUT_MS = 240_000;
const DEFAULT_DATA_DIR = 'data';
// 100 MiB. Enough for a rulebook; raise MAX_PDF_BYTES if a scan is larger.
const DEFAULT_MAX_PDF_BYTES = 100 * 1024 * 1024;

const parsePort = (raw: string | undefined): number => {
	if (raw === undefined || raw.trim() === '') {
		return DEFAULT_PORT;
	}

	const port = Number(raw);

	if (!Number.isInteger(port) || port < 0 || port > 65535) {
		throw new Error(`Invalid PORT "${raw}": must be an integer between 0 and 65535.`);
	}

	return port;
};

const parseList = (raw: string | undefined): string[] =>
	(raw ?? '')
		.split(',')
		.map((value) => value.trim())
		.filter((value) => value !== '');

// Ollama is only ever reached over plain HTTP(S); anything else is a typo.
const parseOllamaUrl = (raw: string | undefined): string => {
	const value = raw?.trim();

	if (value === undefined || value === '') {
		return DEFAULT_OLLAMA_URL;
	}

	let url: URL;

	try {
		url = new URL(value);
	} catch {
		throw new Error(`Invalid OLLAMA_URL "${raw}": must be an absolute http(s) URL.`);
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(`Invalid OLLAMA_URL "${raw}": must be an absolute http(s) URL.`);
	}

	// Normalise away a trailing slash so paths can be appended predictably.
	return url.href.replace(/\/$/, '');
};

const parseOllamaTimeout = (raw: string | undefined): number => {
	if (raw === undefined || raw.trim() === '') {
		return DEFAULT_OLLAMA_TIMEOUT_MS;
	}

	const timeout = Number(raw);

	if (!Number.isInteger(timeout) || timeout <= 0) {
		throw new Error(`Invalid OLLAMA_TIMEOUT_MS "${raw}": must be a positive whole number of milliseconds.`);
	}

	return timeout;
};

// Relative paths are resolved from the process working directory once, at startup.
const parseDataDir = (raw: string | undefined): string => {
	const value = raw?.trim();

	return path.resolve(value === undefined || value === '' ? DEFAULT_DATA_DIR : value);
};

const parseMaxPdfBytes = (raw: string | undefined): number => {
	if (raw === undefined || raw.trim() === '') {
		return DEFAULT_MAX_PDF_BYTES;
	}

	const maxPdfBytes = Number(raw);

	if (!Number.isInteger(maxPdfBytes) || maxPdfBytes <= 0) {
		throw new Error(`Invalid MAX_PDF_BYTES "${raw}": must be a positive whole number of bytes.`);
	}

	return maxPdfBytes;
};

// Builds the application config from environment variables.
// Accepts an env object so tests can pass their own instead of mutating process.env.
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => ({
	port: parsePort(env.PORT),
	host: env.HOST?.trim() || DEFAULT_HOST,
	corsOrigins: parseList(env.CORS_ORIGIN),
	ollamaUrl: parseOllamaUrl(env.OLLAMA_URL),
	ollamaModel: env.OLLAMA_MODEL?.trim() || DEFAULT_OLLAMA_MODEL,
	ollamaTimeoutMs: parseOllamaTimeout(env.OLLAMA_TIMEOUT_MS),
	dataDir: parseDataDir(env.DATA_DIR),
	maxPdfBytes: parseMaxPdfBytes(env.MAX_PDF_BYTES),
});
