import { describe, expect, it } from '@jest/globals';
import { isEnoent } from './isEnoent.ts';

describe('isEnoent', () => {
	it('Accepts an error for a missing path.', () => {
		expect(isEnoent(Object.assign(new Error('missing'), { code: 'ENOENT' }))).toBe(true);
	});

	it.each([
		['another error code', Object.assign(new Error('not a directory'), { code: 'ENOTDIR' })],
		['an error without a code', new Error('failed')],
		['null', null],
		['a string', 'ENOENT'],
	])('Rejects %s.', (_label, value) => {
		expect(isEnoent(value)).toBe(false);
	});
});
