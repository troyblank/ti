import { isRecord } from './isRecord.ts';

// The trimmed text of `body[key]`, or undefined when the body is not an object or the value is not non-blank text.
export const readNonBlankString = (body: unknown, key: string): string | undefined => {
	if (!isRecord(body) || typeof body[key] !== 'string') {
		return undefined;
	}

	const trimmed = body[key].trim();

	return trimmed === '' ? undefined : trimmed;
};
