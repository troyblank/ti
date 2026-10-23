// True when a filesystem call failed because the path does not exist.
export const isEnoent = (error: unknown): boolean =>
	typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
