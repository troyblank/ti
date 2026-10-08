import { describe, expect, it } from '@jest/globals';
import { isRecord } from './isRecord.ts';

describe('isRecord', () => {
	it('Accepts plain objects.', () => {
		expect(isRecord({})).toBe(true);
		expect(isRecord({ message: 'Hello' })).toBe(true);
	});

	it.each([
		['null', null],
		['undefined', undefined],
		['a list', []],
		['a number', 42],
		['a string', 'Hello'],
	])('Rejects %s.', (_label, value) => {
		expect(isRecord(value)).toBe(false);
	});
});
