import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import * as fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { createApp } from '../../app.ts';
import { errorHandler } from '../../middleware/errors.ts';
import { isEnoent } from '../../utils/isEnoent.ts';
import { createDocumentsRouter, displayFilename } from './index.ts';

const PDF = Buffer.from('%PDF-1.4\n% tiny test file\n');

const configFor = (dataDir: string, maxPdfBytes = 1024 * 1024) => ({
	corsOrigins: ['http://localhost:5173'],
	ollamaUrl: 'http://ollama.test:11434',
	ollamaModel: 'llama3.2:3b',
	ollamaTimeoutMs: 60_000,
	dataDir,
	maxPdfBytes,
});

const pdfWithMarkerAt = (offset: number): Buffer => {
	const bytes = Buffer.alloc(offset + '%PDF-'.length, 0x20);

	bytes.set(Buffer.from('%PDF-'), offset);

	return bytes;
};

const listDocuments = async (root: string, folder = 'documents'): Promise<string[]> => {
	try {
		return await fs.readdir(path.join(root, folder));
	} catch (error) {
		if (isEnoent(error)) {
			return [];
		}

		throw error;
	}
};

const waitFor = async (condition: () => Promise<boolean>) => {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		if (await condition()) {
			return;
		}

		await new Promise((resolve) => setTimeout(resolve, 10));
	}

	throw new Error('Condition was not met in time.');
};

describe('displayFilename', () => {
	it.each([
		['the name is empty', ''],
		['the name is blank', '   '],
		['the name is a dot', '.'],
		['the name is a parent directory', '..'],
		['the name is only a directory', '/'],
	])('Uses document.pdf when %s.', (_label, original) => {
		expect(displayFilename(original)).toBe('document.pdf');
	});

	it('Keeps the file name and drops any directory.', () => {
		expect(displayFilename('../../rules.pdf')).toBe('rules.pdf');
		expect(displayFilename('rules.pdf')).toBe('rules.pdf');
	});

	it('Leaves a name of 255 characters unchanged and shortens a longer one.', () => {
		const atLimit = 'a'.repeat(255);
		const tooLong = `${'b'.repeat(300)}.pdf`;

		expect(displayFilename(atLimit)).toBe(atLimit);
		expect(displayFilename(tooLong)).toBe(tooLong.slice(0, 255));
		expect(displayFilename(tooLong)).toHaveLength(255);
	});
});

describe('POST /api/projects/:projectId/documents', () => {
	let dataDir: string;
	let app: ReturnType<typeof createApp>;
	let projectId: string;

	const uploadUrl = () => `/api/projects/${projectId}/documents`;
	const storedDirectory = (documentId: string) => path.join(dataDir, 'projects', projectId, 'documents', documentId);

	beforeEach(async () => {
		dataDir = await fs.mkdtemp(path.join(tmpdir(), 'ti-documents-'));
		app = createApp(configFor(dataDir));

		const created = await request(app).post('/api/projects').send({ name: 'Frosthaven' });

		expect(created.status).toBe(201);
		projectId = created.body.id;
	});

	afterEach(async () => {
		jest.restoreAllMocks();
		await fs.rm(dataDir, { recursive: true, force: true });
	});

	it('Stores an uploaded PDF and returns its id, name, size, and upload time.', async () => {
		const fetchMock = jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('should not be called'));

		const response = await request(app).post(uploadUrl()).attach('file', PDF, 'rules.pdf');

		expect(response.status).toBe(201);
		expect(response.headers['content-type']).toMatch(/application\/json/);
		expect(response.body).toEqual({
			id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
			filename: 'rules.pdf',
			size: PDF.length,
			uploadedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
		});
		expect(new Date(response.body.uploadedAt).toISOString()).toBe(response.body.uploadedAt);
		expect(Math.abs(Date.now() - Date.parse(response.body.uploadedAt))).toBeLessThan(5000);

		const directory = storedDirectory(response.body.id);
		const stored = await fs.readFile(path.join(directory, 'original.pdf'));
		const metadata = JSON.parse(await fs.readFile(path.join(directory, 'metadata.json'), 'utf8'));

		expect(Buffer.compare(stored, PDF)).toBe(0);
		expect(metadata).toEqual(response.body);
		expect((await fs.readdir(directory)).sort()).toEqual(['metadata.json', 'original.pdf']);
		expect(await listDocuments(dataDir, 'incoming')).toEqual([]);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('Stores a PDF larger than the header check byte for byte.', async () => {
		const large = Buffer.concat([PDF, Buffer.alloc(256 * 1024, 'x')]);

		const response = await request(app).post(uploadUrl()).attach('file', large, 'large.pdf');

		expect(response.status).toBe(201);
		expect(response.body.size).toBe(large.length);

		const stored = await fs.readFile(path.join(storedDirectory(response.body.id), 'original.pdf'));

		expect(Buffer.compare(stored, large)).toBe(0);
	});

	it('Keeps a directory in the uploaded name out of the stored filename and the path.', async () => {
		const response = await request(app).post(uploadUrl()).attach('file', PDF, '../../rules.pdf');

		expect(response.status).toBe(201);
		expect(response.body.filename).toBe('rules.pdf');

		const directory = storedDirectory(response.body.id);

		expect((await fs.readdir(directory)).sort()).toEqual(['metadata.json', 'original.pdf']);
	});

	it('Keeps a Windows-style directory out of the stored filename.', async () => {
		const response = await request(app).post(uploadUrl()).attach('file', PDF, 'C:\\Users\\troy\\rules.pdf');

		expect(response.status).toBe(201);
		expect(response.body.filename).toBe('rules.pdf');
	});

	it('Keeps non-ASCII characters in the filename.', async () => {
		const response = await request(app).post(uploadUrl()).attach('file', PDF, 'Règles du jeu.pdf');

		expect(response.status).toBe(201);
		expect(response.body.filename).toBe('Règles du jeu.pdf');
	});

	it('Shortens a very long filename.', async () => {
		const tooLong = `${'b'.repeat(300)}.pdf`;

		const response = await request(app).post(uploadUrl()).attach('file', PDF, tooLong);

		expect(response.status).toBe(201);
		expect(response.body.filename).toBe(tooLong.slice(0, 255));
	});

	it('Gives every upload its own id.', async () => {
		const first = await request(app).post(uploadUrl()).attach('file', PDF, 'one.pdf');
		const second = await request(app).post(uploadUrl()).attach('file', PDF, 'two.pdf');

		expect(first.status).toBe(201);
		expect(second.status).toBe(201);
		expect(first.body.id).not.toBe(second.body.id);
		expect(await listDocuments(dataDir, path.join('projects', projectId, 'documents'))).toEqual(
			expect.arrayContaining([first.body.id, second.body.id]),
		);
	});

	it('Rejects a file that is not a PDF and does not keep it.', async () => {
		const response = await request(app).post(uploadUrl()).attach('file', Buffer.from('hello'), 'notes.pdf');

		expect(response.status).toBe(415);
		expect(response.body).toEqual({ error: 'Unsupported Media Type' });
		expect(await listDocuments(dataDir, path.join('projects', projectId, 'documents'))).toEqual([]);
	});

	it('Rejects a large file that is not a PDF and does not keep it.', async () => {
		const response = await request(app).post(uploadUrl()).attach('file', Buffer.alloc(512 * 1024, 'x'), 'archive.pdf');

		expect(response.status).toBe(415);
		expect(response.body).toEqual({ error: 'Unsupported Media Type' });
		expect(await listDocuments(dataDir, path.join('projects', projectId, 'documents'))).toEqual([]);
		expect(await listDocuments(dataDir, 'incoming')).toEqual([]);
	});

	it('Accepts a PDF whose header appears later in the first 1024 bytes.', async () => {
		const shifted = pdfWithMarkerAt(1019);
		const tolerant = createApp(configFor(dataDir, 2048));

		const response = await request(tolerant).post(uploadUrl()).attach('file', shifted, 'shifted.pdf');

		expect(response.status).toBe(201);
		expect(response.body.size).toBe(shifted.length);
	});

	it('Rejects a file whose PDF header starts after the first 1024 bytes and does not keep it.', async () => {
		const tooLate = pdfWithMarkerAt(1020);
		const tolerant = createApp(configFor(dataDir, 2048));

		const response = await request(tolerant).post(uploadUrl()).attach('file', tooLate, 'late.pdf');

		expect(response.status).toBe(415);
		expect(response.body).toEqual({ error: 'Unsupported Media Type' });
		expect(await listDocuments(dataDir, path.join('projects', projectId, 'documents'))).toEqual([]);
	});

	it.each([
		['the body is JSON', () => request(app).post(uploadUrl()).send({ file: 'rules.pdf' })],
		['the file field is missing', () => request(app).post(uploadUrl())],
		['the PDF is sent under the wrong field name', () => request(app).post(uploadUrl()).attach('document', PDF, 'rules.pdf')],
		['a text field is included', () => request(app).post(uploadUrl()).field('note', 'hello').attach('file', PDF, 'rules.pdf')],
		[
			'more than one file is included',
			() => request(app).post(uploadUrl()).attach('file', PDF, 'one.pdf').attach('file', PDF, 'two.pdf'),
		],
	])('Responds with a JSON 400 when %s.', async (_label, send) => {
		const response = await send();

		expect(response.status).toBe(400);
		expect(response.body).toEqual({ error: 'Bad Request' });
		expect(await listDocuments(dataDir, path.join('projects', projectId, 'documents'))).toEqual([]);
	});

	it('Rejects a PDF larger than the size limit and does not keep it.', async () => {
		const small = createApp(configFor(dataDir, PDF.length - 1));

		const response = await request(small).post(uploadUrl()).attach('file', PDF, 'rules.pdf');

		expect(response.status).toBe(413);
		expect(response.body).toEqual({ error: 'Payload Too Large' });
		expect(await listDocuments(dataDir, path.join('projects', projectId, 'documents'))).toEqual([]);
	});

	it('Accepts a PDF that is exactly at the size limit.', async () => {
		const exact = Buffer.from('%PDF-1.4');
		const small = createApp(configFor(dataDir, exact.length));

		const response = await request(small).post(uploadUrl()).attach('file', exact, 'rules.pdf');

		expect(response.status).toBe(201);
		expect(response.body.size).toBe(exact.length);
	});

	it('Responds with a generic JSON 500 when the upload cannot be written, and does not keep it.', async () => {
		const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

		await fs.rm(path.join(dataDir, 'incoming'), { recursive: true, force: true });
		await fs.writeFile(path.join(dataDir, 'incoming'), 'not a directory');

		const response = await request(app).post(uploadUrl()).attach('file', PDF, 'rules.pdf');

		expect(response.status).toBe(500);
		expect(response.body).toEqual({ error: 'Internal Server Error' });
		expect(consoleError.mock.calls[0]?.[0]).toMatchObject({ code: 'ENOTDIR' });
		expect(await listDocuments(dataDir, path.join('projects', projectId, 'documents'))).toEqual([]);
	});

	it('Responds with a generic JSON 500 when an upload is not tied to a project, and does not keep it.', async () => {
		const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
		const uploadApp = express();

		uploadApp.use('/api/documents', createDocumentsRouter(configFor(dataDir)));
		uploadApp.use(errorHandler);

		const response = await request(uploadApp).post('/api/documents').attach('file', PDF, 'rules.pdf');

		expect(response.status).toBe(500);
		expect(response.body).toEqual({ error: 'Internal Server Error' });
		expect(consoleError.mock.calls[0]?.[0]).toEqual(new Error('Project id is missing.'));
		expect(await listDocuments(dataDir, 'incoming')).toEqual([]);
		expect(await listDocuments(dataDir, path.join('projects', projectId, 'documents'))).toEqual([]);
	});

	it('Responds with a generic JSON 500 when the document metadata cannot be saved, and does not keep the upload.', async () => {
		const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
		const failure = new Error('disk full');
		const writeMetadata = (): Promise<void> => Promise.reject(failure);
		const uploadApp = express();

		uploadApp.use('/api/projects/:projectId/documents', createDocumentsRouter(configFor(dataDir), writeMetadata));
		uploadApp.use(errorHandler);

		const response = await request(uploadApp).post(uploadUrl()).attach('file', PDF, 'rules.pdf');

		expect(response.status).toBe(500);
		expect(response.body).toEqual({ error: 'Internal Server Error' });
		expect(consoleError).toHaveBeenCalledWith(failure);
		expect(await listDocuments(dataDir, path.join('projects', projectId, 'documents'))).toEqual([]);
	});

	it('Responds with a generic JSON 500 when the data directory cannot be written.', async () => {
		const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
		const blocked = path.join(dataDir, 'blocked');
		await fs.writeFile(blocked, 'not a directory');
		const unwritable = createApp(configFor(path.join(blocked, 'nested')));

		const response = await request(unwritable).post(uploadUrl()).attach('file', PDF, 'rules.pdf');

		expect(response.status).toBe(500);
		expect(response.body).toEqual({ error: 'Internal Server Error' });
		expect(consoleError).toHaveBeenCalledTimes(1);
		expect(consoleError.mock.calls[0]?.[0]).toMatchObject({ code: 'ENOTDIR' });
		expect(await listDocuments(dataDir, path.join('projects', projectId, 'documents'))).toEqual([]);
	});

	it('Cleans up quietly when the client disconnects mid-upload.', async () => {
		const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
		const server = app.listen(0, '127.0.0.1');
		await once(server, 'listening');

		try {
			const boundary = 'ti-test-boundary';
			const client = http.request({
				host: '127.0.0.1',
				port: (server.address() as AddressInfo).port,
				method: 'POST',
				path: uploadUrl(),
				headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': 100_000 },
			});

			client.on('error', () => {});
			client.write(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="rules.pdf"\r\n\r\n%PDF-1.4\n`);

			await waitFor(async () => (await listDocuments(dataDir, 'incoming')).length === 1);
			client.destroy();
			await waitFor(async () => (await listDocuments(dataDir, 'incoming')).length === 0);
			await new Promise((resolve) => setTimeout(resolve, 50));
		} finally {
			server.closeAllConnections();
			server.close();
		}

		expect(consoleError).not.toHaveBeenCalled();
		expect(await listDocuments(dataDir, path.join('projects', projectId, 'documents'))).toEqual([]);
	});

	it('Stores the PDF only in the project it was uploaded to.', async () => {
		const other = await request(app).post('/api/projects').send({ name: 'Gloomhaven' });

		const response = await request(app).post(uploadUrl()).attach('file', PDF, 'rules.pdf');

		expect(other.status).toBe(201);
		expect(response.status).toBe(201);
		expect(await listDocuments(dataDir, path.join('projects', projectId, 'documents'))).toEqual([response.body.id]);
		expect(await listDocuments(dataDir, path.join('projects', other.body.id, 'documents'))).toEqual([]);
	});

	it('Responds with a JSON 404 when the project does not exist, and does not keep the upload.', async () => {
		const missing = randomUUID();

		const response = await request(app).post(`/api/projects/${missing}/documents`).attach('file', PDF, 'rules.pdf');

		expect(response.status).toBe(404);
		expect(response.body).toEqual({ error: 'Not Found' });
		expect(await listDocuments(dataDir, 'incoming')).toEqual([]);
		await expect(fs.access(path.join(dataDir, 'projects', missing))).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it.each(['not-a-uuid', '00000000-0000-4000-8000-000000000001'.toUpperCase()])(
		'Responds with a JSON 404 when the project id is %s, and does not keep the upload.',
		async (id) => {
			const response = await request(app).post(`/api/projects/${id}/documents`).attach('file', PDF, 'rules.pdf');

			expect(response.status).toBe(404);
			expect(response.body).toEqual({ error: 'Not Found' });
			expect(await listDocuments(dataDir, 'incoming')).toEqual([]);
			expect(await fs.readdir(path.join(dataDir, 'projects'))).toEqual([projectId]);
		},
	);

	it('Responds with a JSON 404 when a project upload is called with a method other than POST.', async () => {
		const response = await request(app).get(uploadUrl());

		expect(response.status).toBe(404);
		expect(response.body).toEqual({ error: 'Not Found' });
	});

	it('Responds with a JSON 404 for a path under a project upload.', async () => {
		const response = await request(app).get(`${uploadUrl()}/${randomUUID()}`);

		expect(response.status).toBe(404);
		expect(response.body).toEqual({ error: 'Not Found' });
	});

	it('Responds with a JSON 404 for the old upload route, and does not keep the file.', async () => {
		const response = await request(app).post('/api/documents').attach('file', PDF, 'rules.pdf');

		expect(response.status).toBe(404);
		expect(response.body).toEqual({ error: 'Not Found' });
		expect(await listDocuments(dataDir, path.join('projects', projectId, 'documents'))).toEqual([]);
		expect(await listDocuments(dataDir, 'incoming')).toEqual([]);
	});
});
