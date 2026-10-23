import * as fs from 'node:fs/promises';

// Metadata files are tab-indented JSON with a trailing newline, so they read well on the NAS.
export const writeJsonFile = (filePath: string, value: unknown): Promise<void> =>
	fs.writeFile(filePath, `${JSON.stringify(value, null, '\t')}\n`, 'utf8');

// Cleanup must not replace the caller's own result. The folder may already be
// gone, and a failed removal still leaves the original outcome as the response.
export const removeDirectoryQuietly = (directory: string): Promise<void> =>
	fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
