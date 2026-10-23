import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createApp } from '../../app.ts';
import { errorHandler } from '../../middleware/errors.ts';
import { isEnoent } from '../../utils/isEnoent.ts';
import { createProjectsRouter, MAX_PROJECT_NAME_LENGTH } from './index.ts';
import { prepareStorage, readProject } from './storage.ts';

const PROJECT_ID = '00000000-0000-4000-8000-000000000001';

const configFor = (dataDir: string) => ({
	corsOrigins: ['http://localhost:5173'],
	ollamaUrl: 'http://ollama.test:11434',
	ollamaModel: 'llama3.2:3b',
	ollamaTimeoutMs: 60_000,
	dataDir,
	maxPdfBytes: 1024,
});

const listNames = async (directory: string): Promise<string[]> => {
	try {
		return await fs.readdir(directory);
	} catch (error) {
		if (isEnoent(error)) {
			return [];
		}

		throw error;
	}
};

describe('prepareStorage', () => {
	let dataDir: string;

	beforeEach(async () => {
		dataDir = await fs.mkdtemp(path.join(tmpdir(), 'ti-storage-'));
	});

	afterEach(async () => {
		await fs.rm(dataDir, { recursive: true, force: true });
	});

	it('Creates the projects and incoming folders.', async () => {
		const root = path.join(dataDir, 'fresh');

		await prepareStorage(root);

		expect((await fs.readdir(root)).sort()).toEqual(['incoming', 'projects']);
	});

	it('Clears uploads a previous run left unfinished and keeps stored projects.', async () => {
		await fs.mkdir(path.join(dataDir, 'incoming', 'half-written'), { recursive: true });
		await fs.mkdir(path.join(dataDir, 'projects', 'kept'), { recursive: true });

		await prepareStorage(dataDir);

		expect(await listNames(path.join(dataDir, 'incoming'))).toEqual([]);
		expect(await listNames(path.join(dataDir, 'projects'))).toEqual(['kept']);
	});

	it('Leaves documents uploaded before projects existed where they are.', async () => {
		await fs.mkdir(path.join(dataDir, 'documents', 'kept'), { recursive: true });

		await prepareStorage(dataDir);

		expect(await listNames(path.join(dataDir, 'documents'))).toEqual(['kept']);
		expect((await fs.readdir(dataDir)).sort()).toEqual(['documents', 'incoming', 'projects']);
	});

	it('Explains which folder cannot be written when DATA_DIR is unusable.', async () => {
		const blocked = path.join(dataDir, 'blocked');
		await fs.writeFile(blocked, 'not a directory');

		await expect(prepareStorage(blocked)).rejects.toThrow(`Cannot write to DATA_DIR "${blocked}"`);
		await expect(prepareStorage(blocked)).rejects.toMatchObject({
			cause: { code: expect.stringMatching(/^(EEXIST|ENOTDIR)$/) },
		});
	});
});

describe('readProject', () => {
	it('Treats a project id given as a list of strings as no project.', async () => {
		await expect(readProject(tmpdir(), [PROJECT_ID])).resolves.toBeUndefined();
	});
});

describe('Projects API', () => {
	let dataDir: string;
	let app: ReturnType<typeof createApp>;

	const writeProjectFile = async (id: string, contents: string) => {
		const directory = path.join(dataDir, 'projects', id);

		await fs.mkdir(directory, { recursive: true });
		await fs.writeFile(path.join(directory, 'project.json'), contents);
	};

	beforeEach(async () => {
		dataDir = await fs.mkdtemp(path.join(tmpdir(), 'ti-projects-'));
		app = createApp(configFor(dataDir));
	});

	afterEach(async () => {
		jest.restoreAllMocks();
		await fs.rm(dataDir, { recursive: true, force: true });
	});

	it('Creates a project and stores its name as metadata, not as a path.', async () => {
		const response = await request(app).post('/api/projects').send({ name: '  Frosthaven  ' });

		expect(response.status).toBe(201);
		expect(response.headers['content-type']).toMatch(/application\/json/);
		expect(response.body).toEqual({
			id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
			name: 'Frosthaven',
			createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
		});
		expect(new Date(response.body.createdAt).toISOString()).toBe(response.body.createdAt);
		expect(Math.abs(Date.now() - Date.parse(response.body.createdAt))).toBeLessThan(5000);

		const directory = path.join(dataDir, 'projects', response.body.id);
		const saved = JSON.parse(await fs.readFile(path.join(directory, 'project.json'), 'utf8'));

		expect(saved).toEqual(response.body);
		expect(await fs.readdir(directory)).toEqual(['project.json']);
		expect(await listNames(path.join(dataDir, 'incoming'))).toEqual([]);

		const listed = await request(app).get('/api/projects');

		expect(listed.status).toBe(200);
		expect(listed.body).toEqual([response.body]);
	});

	it('Keeps a name that looks like a path out of the filesystem.', async () => {
		const response = await request(app).post('/api/projects').send({ name: '../../outside' });

		expect(response.status).toBe(201);
		expect(response.body.name).toBe('../../outside');
		expect(await fs.readdir(path.join(dataDir, 'projects'))).toEqual([response.body.id]);
		await expect(fs.access(path.join(dataDir, 'outside'))).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('Gives every project its own id, even when the name is reused.', async () => {
		const first = await request(app).post('/api/projects').send({ name: 'Frosthaven' });
		const second = await request(app).post('/api/projects').send({ name: 'Frosthaven' });

		expect(first.status).toBe(201);
		expect(second.status).toBe(201);
		expect(first.body.id).not.toBe(second.body.id);
	});

	it('Returns an empty list when there are no projects.', async () => {
		const response = await request(app).get('/api/projects');

		expect(response.status).toBe(200);
		expect(response.headers['content-type']).toMatch(/application\/json/);
		expect(response.body).toEqual([]);
	});

	it('Lists projects oldest first, and by id when they were created together.', async () => {
		const earlier = '00000000-0000-4000-8000-000000000001';
		const later = '00000000-0000-4000-8000-000000000002';
		const tied = '00000000-0000-4000-8000-000000000003';
		const createdAt = '2020-01-01T00:00:00.000Z';

		await writeProjectFile(later, JSON.stringify({ id: later, name: 'Later', createdAt: '2021-01-01T00:00:00.000Z', note: 'ignore' }));
		await writeProjectFile(tied, JSON.stringify({ id: tied, name: 'Tied', createdAt }));
		await writeProjectFile(earlier, JSON.stringify({ id: earlier, name: 'Earlier', createdAt }));

		const response = await request(app).get('/api/projects');

		expect(response.status).toBe(200);
		expect(response.body).toEqual([
			{ id: earlier, name: 'Earlier', createdAt },
			{ id: tied, name: 'Tied', createdAt },
			{ id: later, name: 'Later', createdAt: '2021-01-01T00:00:00.000Z' },
		]);
	});

	it.each([
		['the name is missing', {}],
		['the name is blank', { name: '   ' }],
		['the name is not text', { name: 42 }],
		['the body is a list', []],
		['the body is JSON null', null],
		['the body is a bare number', 42],
	])('Responds with a JSON 400 when %s.', async (_label, body) => {
		const response = await request(app).post('/api/projects').set('Content-Type', 'application/json').send(JSON.stringify(body));

		expect(response.status).toBe(400);
		expect(response.body).toEqual({ error: 'Bad Request' });
		expect(await listNames(path.join(dataDir, 'projects'))).toEqual([]);
	});

	it('Responds with a JSON 413 when the name is too long.', async () => {
		const response = await request(app)
			.post('/api/projects')
			.send({ name: 'a'.repeat(MAX_PROJECT_NAME_LENGTH + 1) });

		expect(response.status).toBe(413);
		expect(response.body).toEqual({ error: 'Payload Too Large' });
		expect(await listNames(path.join(dataDir, 'projects'))).toEqual([]);
	});

	it('Accepts a name that is exactly at the length limit.', async () => {
		const name = 'a'.repeat(MAX_PROJECT_NAME_LENGTH);

		const response = await request(app).post('/api/projects').send({ name });

		expect(response.status).toBe(201);
		expect(response.body.name).toBe(name);
	});

	it('Responds with a JSON 404 for project routes other than create, list, upload, and chat.', async () => {
		const created = await request(app).post('/api/projects').send({ name: 'Frosthaven' });

		const response = await request(app).get(`/api/projects/${created.body.id}`);

		expect(response.status).toBe(404);
		expect(response.body).toEqual({ error: 'Not Found' });
	});

	it('Responds with a JSON 404 when asking a project that does not exist, and does not ask the model.', async () => {
		const fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('should not be called'));

		const response = await request(app).post(`/api/projects/${randomUUID()}/chat`).send({ message: 'Hello' });

		expect(response.status).toBe(404);
		expect(response.body).toEqual({ error: 'Not Found' });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('Responds with a JSON 404 when the chat project id is not a UUID, and does not ask the model.', async () => {
		const fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('should not be called'));

		const response = await request(app).post('/api/projects/not-a-uuid/chat').send({ message: 'Hello' });

		expect(response.status).toBe(404);
		expect(response.body).toEqual({ error: 'Not Found' });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('Skips entries in the projects folder that are not projects.', async () => {
		const created = await request(app).post('/api/projects').send({ name: 'Frosthaven' });

		await fs.mkdir(path.join(dataDir, 'projects', '@eaDir'), { recursive: true });
		await fs.writeFile(path.join(dataDir, 'projects', '.DS_Store'), 'not a project');

		const response = await request(app).get('/api/projects');

		expect(response.status).toBe(200);
		expect(response.body).toEqual([created.body]);
	});

	it('Finds a project when its id is written in uppercase.', async () => {
		jest.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify({ message: { role: 'assistant', content: 'Hi there.' } }), {
				headers: { 'Content-Type': 'application/json' },
			}),
		);
		const created = await request(app).post('/api/projects').send({ name: 'Frosthaven' });

		const response = await request(app).post(`/api/projects/${created.body.id.toUpperCase()}/chat`).send({ message: 'Hello' });

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ message: 'Hi there.' });
	});

	it.each([
		['the file is not JSON', '{'],
		['the file is not an object', 'null'],
		['the id does not match the folder', JSON.stringify({ id: 'other', name: 'Frosthaven', createdAt: '2020-01-01T00:00:00.000Z' })],
		['the name is not text', JSON.stringify({ id: PROJECT_ID, name: 1, createdAt: '2020-01-01T00:00:00.000Z' })],
		['the creation time is not text', JSON.stringify({ id: PROJECT_ID, name: 'Frosthaven', createdAt: 1 })],
	])('Responds with a generic JSON 500 when project metadata has a problem: %s.', async (_label, contents) => {
		const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

		await writeProjectFile(PROJECT_ID, contents);

		const response = await request(app).get('/api/projects');

		expect(response.status).toBe(500);
		expect(response.body).toEqual({ error: 'Internal Server Error' });
		expect(consoleError).toHaveBeenCalledTimes(1);
	});

	it('Responds with a generic JSON 500 when a project folder has no metadata.', async () => {
		const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

		await fs.mkdir(path.join(dataDir, 'projects', PROJECT_ID), { recursive: true });

		const response = await request(app).get('/api/projects');

		expect(response.status).toBe(500);
		expect(response.body).toEqual({ error: 'Internal Server Error' });
		expect(consoleError.mock.calls[0]?.[0]).toMatchObject({ code: 'ENOENT' });
	});

	it('Responds with a generic JSON 500 when the projects folder cannot be read.', async () => {
		const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

		await fs.writeFile(path.join(dataDir, 'projects'), 'not a directory');

		const response = await request(app).get('/api/projects');

		expect(response.status).toBe(500);
		expect(response.body).toEqual({ error: 'Internal Server Error' });
		expect(consoleError.mock.calls[0]?.[0]).toMatchObject({ code: 'ENOTDIR' });
	});

	it('Responds with a generic JSON 500 when a new project cannot be saved, and does not keep it.', async () => {
		const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
		const failure = new Error('disk full');
		const writeProject = (): Promise<void> => Promise.reject(failure);
		const failing = express();

		failing.use(express.json());
		failing.use('/api/projects', createProjectsRouter(configFor(dataDir), writeProject));
		failing.use(errorHandler);

		const response = await request(failing).post('/api/projects').send({ name: 'Frosthaven' });

		expect(response.status).toBe(500);
		expect(response.body).toEqual({ error: 'Internal Server Error' });
		expect(consoleError).toHaveBeenCalledWith(failure);
		expect(await listNames(path.join(dataDir, 'projects'))).toEqual([]);
		expect(await listNames(path.join(dataDir, 'incoming'))).toEqual([]);
	});

	it('Still reports that failure when the unfinished project cannot be removed.', async () => {
		const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
		const failure = new Error('disk full');
		// Replacing incoming/ with a file makes the cleanup removal fail the way a busy
		// disk would, so the original save error is what the client hears about.
		const writeProject = async (filePath: string): Promise<void> => {
			const incoming = path.dirname(path.dirname(filePath));

			await fs.rename(incoming, `${incoming}-held`);
			await fs.writeFile(incoming, 'not a directory');

			throw failure;
		};
		const failing = express();

		failing.use(express.json());
		failing.use('/api/projects', createProjectsRouter(configFor(dataDir), writeProject));
		failing.use(errorHandler);

		const response = await request(failing).post('/api/projects').send({ name: 'Frosthaven' });

		expect(response.status).toBe(500);
		expect(response.body).toEqual({ error: 'Internal Server Error' });
		expect(consoleError).toHaveBeenCalledWith(failure);
	});
});
