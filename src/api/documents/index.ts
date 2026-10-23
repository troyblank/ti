import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Router, type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import type { Config } from '../../config.ts';
import { sendError } from '../../middleware/errors.ts';
import { removeDirectoryQuietly, writeJsonFile } from '../../utils/stagedFiles.ts';
import { requestProject } from '../projects/requestProject.ts';
import { INCOMING_DIR, projectDocumentsDirectory } from '../projects/storage.ts';

// The PDF spec allows the header anywhere in the first 1024 bytes.
const PDF_HEADER_BYTES = 1024;
const PDF_MARKER = Buffer.from('%PDF-');
const MAX_FILENAME_LENGTH = 255;
const STORED_PDF_NAME = 'original.pdf';
const METADATA_NAME = 'metadata.json';
// Uploads are assembled in incoming/ and renamed under the project once complete, so a crash
// mid-upload never leaves a half-written document where later steps will look.

export type DocumentMetadata = {
	id: string;
	filename: string;
	size: number;
	uploadedAt: string;
};

export type DocumentsConfig = Pick<Config, 'dataDir' | 'maxPdfBytes'>;

type StagedDocument = {
	id: string;
	directory: string;
};

class NotPdfError extends Error {}

// The caller's name is metadata only. It is never used as a path on disk.
export const displayFilename = (original: string): string => {
	const base = path.basename(original).trim();

	if (base === '' || base === '.' || base === '..') {
		return 'document.pdf';
	}

	return base.slice(0, MAX_FILENAME_LENGTH);
};

// Holds back the first 1024 bytes until they are known to contain the PDF marker,
// so a file that is not a PDF is rejected before the rest of it is written.
const requirePdfHeader = (): Transform => {
	let head = Buffer.alloc(0);
	let checked = false;

	const release = (callback: TransformCallback) => {
		checked = true;

		if (!head.subarray(0, PDF_HEADER_BYTES).includes(PDF_MARKER)) {
			callback(new NotPdfError());

			return;
		}

		callback(null, head);
	};

	return new Transform({
		transform(chunk: Buffer, _encoding, callback) {
			if (checked) {
				callback(null, chunk);

				return;
			}

			head = Buffer.concat([head, chunk]);

			if (head.length < PDF_HEADER_BYTES) {
				callback();

				return;
			}

			release(callback);
		},
		flush(callback) {
			if (checked) {
				callback();

				return;
			}

			release(callback);
		},
	});
};

// Writes the upload as <staged directory>/original.pdf. The staged directory is
// named by a generated id, so a filename can never choose a path.
const stagedPdfStorage = (stage: (request: Request) => Promise<StagedDocument>): multer.StorageEngine => ({
	_handleFile(request, file, callback) {
		stage(request)
			.then(async ({ directory }) => {
				const destination = path.join(directory, STORED_PDF_NAME);

				await pipeline(file.stream, requirePdfHeader(), createWriteStream(destination));

				const { size } = await fs.stat(destination);

				return { path: destination, size };
			})
			.then(
				(info) => callback(null, info),
				(error: unknown) => callback(error),
			);
	},
	_removeFile(_request, file, callback) {
		fs.rm(file.path, { force: true }).then(() => callback(null), callback);
	},
});

const statusForUploadError = (error: unknown): number | undefined => {
	if (error instanceof NotPdfError) {
		return 415;
	}

	if (!(error instanceof multer.MulterError)) {
		return undefined;
	}

	return error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
};

const storeDocument = async (
	request: Request,
	response: Response,
	next: NextFunction,
	error: unknown,
	document: StagedDocument | undefined,
	dataDir: string,
	writeMetadata: (filePath: string, metadata: DocumentMetadata) => Promise<void>,
) => {
	if (error) {
		if (document !== undefined) {
			await removeDirectoryQuietly(document.directory);
		}

		// The client hung up mid-upload. Nothing failed on our side and no one is listening.
		// Check the socket: a request is also `destroyed` once its body has been read.
		if (request.socket.destroyed) {
			return;
		}

		const status = statusForUploadError(error);

		if (status !== undefined) {
			sendError(response, status);

			return;
		}

		next(error);

		return;
	}

	const file = request.file;

	if (file === undefined || document === undefined) {
		sendError(response, 400);

		return;
	}

	try {
		const metadata: DocumentMetadata = {
			id: document.id,
			filename: displayFilename(file.originalname),
			size: file.size,
			uploadedAt: new Date().toISOString(),
		};

		await writeMetadata(path.join(document.directory, METADATA_NAME), metadata);

		const documentsDir = projectDocumentsDirectory(dataDir, requestProject(response).id);

		await fs.mkdir(documentsDir, { recursive: true });
		await fs.rename(document.directory, path.join(documentsDir, document.id));
		response.status(201).json(metadata);
	} catch (failure) {
		await removeDirectoryQuietly(document.directory);

		throw failure;
	}
};

// POST / — store one PDF under the project and return its metadata.
// Mounted at /api/projects/:projectId/documents. The caller has already checked the project exists.
// Bytes are kept as projects/<projectId>/documents/<id>/original.pdf, so a filename can never choose a path.
export const createDocumentsRouter = (
	{ dataDir, maxPdfBytes }: DocumentsConfig,
	writeMetadata: (filePath: string, metadata: DocumentMetadata) => Promise<void> = writeJsonFile,
): Router => {
	const router = Router();
	const staged = new WeakMap<Request, StagedDocument>();

	const stage = async (request: Request): Promise<StagedDocument> => {
		const id = randomUUID();
		const document = { id, directory: path.join(dataDir, INCOMING_DIR, id) };

		staged.set(request, document);
		await fs.mkdir(document.directory, { recursive: true });

		return document;
	};

	const upload = multer({
		// curl and browsers send UTF-8 filenames without declaring a charset.
		defParamCharset: 'utf8',
		limits: { fileSize: maxPdfBytes, files: 1, fields: 0 },
		storage: stagedPdfStorage(stage),
	}).single('file');

	router.post('/', (request, response, next) => {
		upload(request, response, (uploadError?: unknown) => {
			void storeDocument(request, response, next, uploadError, staged.get(request), dataDir, writeMetadata).catch(next);
		});
	});

	return router;
};
