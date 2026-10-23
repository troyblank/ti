import { describe, expect, it } from '@jest/globals';
import { readNonBlankString } from './readNonBlankString.ts';

describe('readNonBlankString', () => {
	it('Returns the trimmed text.', () => {
		expect(readNonBlankString({ name: '  Frosthaven  ' }, 'name')).toBe('Frosthaven');
	});

	it.each([
		['the key is missing', {}],
		['the text is blank', { name: '   ' }],
		['the value is not text', { name: 42 }],
		['the body is a list', []],
		['the body is null', null],
	])('Returns undefined when %s.', (_label, body) => {
		expect(readNonBlankString(body, 'name')).toBeUndefined();
	});
});
