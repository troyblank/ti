import {
	jest,
	describe,
	it,
	expect,
	beforeAll,
	beforeEach,
	afterAll,
	afterEach,
} from '@jest/globals';

const g = globalThis as unknown as Record<string, unknown>;
g.jest = jest;
g.describe = describe;
g.it = it;
g.expect = expect;
g.beforeAll = beforeAll;
g.beforeEach = beforeEach;
g.afterAll = afterAll;
g.afterEach = afterEach;
