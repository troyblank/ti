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

// The PDF spec allows the header anywhere in the first 1024 bytes.
const PDF_HEADER_BYTES = 1024;
const PDF_MARKER = Buffer.from('%PDF-');
const MAX_FILENAME_LENGTH = 255;
const STORED_PDF_NAME = 'original.pdf';
const METADATA_NAME = 'metadata.json';
const DOCUMENTS_DIR = 'documents';
// Uploads are assembled here and renamed into documents/ once complete, so a crash
// mid-upload never leaves a half-written document where later steps will look.
const INCOMING_DIR = 'incoming';

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

// Runs once at startup. Fails fast if DATA_DIR cannot be written, instead of every
// upload failing with a 500, and clears uploads a previous run left unfinished.
export const prepareDocumentStorage = async (dataDir: string): Promise<void> => {
	const documents = path.join(dataDir, DOCUMENTS_DIR);
	const incoming = path.join(dataDir, INCOMING_DIR);

	try {
		await fs.mkdir(documents, { recursive: true });
		await fs.access(documents, fs.constants.W_OK);
		await fs.rm(incoming, { recursive: true, force: true });
		await fs.mkdir(incoming);
	} catch (error) {
		throw new Error(
			`Cannot write to DATA_DIR "${dataDir}". Make sure the user running TI owns it (in Docker that is uid 1000).`,
			{ cause: error },
		);
	}
};

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

// Cleanup must not replace the upload's own result. The folder may already be
// gone, and a failed removal still leaves the original status as the response.
const removeDocument = (directory: string) => fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);

const writeMetadataFile = (filePath: string, metadata: DocumentMetadata) =>
	fs.writeFile(filePath, `${JSON.stringify(metadata, null, '\t')}\n`, 'utf8');

const storeDocument = async (
	request: Request,
	response: Response,
	next: NextFunction,
	error: unknown,
	document: StagedDocument | undefined,
	documentsDir: string,
	writeMetadata: (filePath: string, metadata: DocumentMetadata) => Promise<void>,
) => {
	if (error) {
		if (document !== undefined) {
			await removeDocument(document.directory);
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
		await fs.mkdir(documentsDir, { recursive: true });
		await fs.rename(document.directory, path.join(documentsDir, document.id));
		response.status(201).json(metadata);
	} catch (failure) {
		await removeDocument(document.directory);

		throw failure;
	}
};

// POST /api/documents — store one PDF under DATA_DIR and return its metadata.
// Bytes are kept as documents/<id>/original.pdf, so a filename can never choose a path.
export const createDocumentsRouter = (
	{ dataDir, maxPdfBytes }: DocumentsConfig,
	writeMetadata: (filePath: string, metadata: DocumentMetadata) => Promise<void> = writeMetadataFile,
): Router => {
	const router = Router();
	const documentsDir = path.join(dataDir, DOCUMENTS_DIR);
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
			void storeDocument(request, response, next, uploadError, staged.get(request), documentsDir, writeMetadata).catch(next);
		});
	});

	return router;
};
