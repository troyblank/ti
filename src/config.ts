export type Config = {
	port: number;
	host: string;
	corsOrigins: string[];
};

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '0.0.0.0';

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

// Builds the application config from environment variables.
// Accepts an env object so tests can pass their own instead of mutating process.env.
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => ({
	port: parsePort(env.PORT),
	host: env.HOST?.trim() || DEFAULT_HOST,
	corsOrigins: parseList(env.CORS_ORIGIN),
});
