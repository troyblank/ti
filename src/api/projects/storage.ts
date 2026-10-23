import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { isEnoent } from '../../utils/isEnoent.ts';
import { isRecord } from '../../utils/isRecord.ts';
import { removeDirectoryQuietly, writeJsonFile } from '../../utils/stagedFiles.ts';

export const PROJECTS_DIR = 'projects';
export const INCOMING_DIR = 'incoming';
const DOCUMENTS_DIR = 'documents';
const PROJECT_FILE = 'project.json';

// Generated ids only (randomUUID is lowercase). A project id from the URL is rejected
// unless it matches, so it can never be used to escape DATA_DIR.
const PROJECT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type Project = {
	id: string;
	name: string;
	createdAt: string;
};

export type WriteProject = (filePath: string, project: Project) => Promise<void>;

const isProjectId = (value: string): boolean => PROJECT_ID_PATTERN.test(value);

// Express types a path parameter as a string or a list of strings. Only a single UUID is a project id.
// UUIDs are case-insensitive, so an uppercased id still names the stored, lowercase project.
const validProjectId = (value: string | string[] | undefined): string | undefined => {
	const lowercase = typeof value === 'string' ? value.toLowerCase() : '';

	return isProjectId(lowercase) ? lowercase : undefined;
};

export const projectDirectory = (dataDir: string, projectId: string): string => path.join(dataDir, PROJECTS_DIR, projectId);

export const projectDocumentsDirectory = (dataDir: string, projectId: string): string =>
	path.join(projectDirectory(dataDir, projectId), DOCUMENTS_DIR);

// Runs once at startup. Fails fast if DATA_DIR cannot be written, instead of every
// upload failing with a 500, and clears uploads a previous run left unfinished.
// Documents uploaded before projects existed stay in data/documents/; they are not moved.
export const prepareStorage = async (dataDir: string): Promise<void> => {
	const projects = path.join(dataDir, PROJECTS_DIR);
	const incoming = path.join(dataDir, INCOMING_DIR);

	try {
		await fs.mkdir(projects, { recursive: true });
		await fs.access(projects, fs.constants.W_OK);
		await fs.rm(incoming, { recursive: true, force: true });
		await fs.mkdir(incoming);
	} catch (error) {
		throw new Error(
			`Cannot write to DATA_DIR "${dataDir}". Make sure the user running TI owns it (in Docker that is uid 1000).`,
			{ cause: error },
		);
	}
};

const parseProject = (value: unknown, directoryName: string): Project => {
	if (
		!isRecord(value) ||
		value.id !== directoryName ||
		typeof value.name !== 'string' ||
		typeof value.createdAt !== 'string'
	) {
		throw new Error(`Invalid project metadata in "${directoryName}".`);
	}

	return { id: directoryName, name: value.name, createdAt: value.createdAt };
};

const readStoredProject = async (directory: string, directoryName: string): Promise<Project> => {
	const raw = await fs.readFile(path.join(directory, PROJECT_FILE), 'utf8');

	return parseProject(JSON.parse(raw), directoryName);
};

// Undefined means there is no such project. Anything else wrong with the metadata is thrown.
export const readProject = async (dataDir: string, projectId: string | string[] | undefined): Promise<Project | undefined> => {
	const id = validProjectId(projectId);

	if (id === undefined) {
		return undefined;
	}

	try {
		return await readStoredProject(projectDirectory(dataDir, id), id);
	} catch (error) {
		if (isEnoent(error)) {
			return undefined;
		}

		throw error;
	}
};

// Oldest first, then by id, so the order stays put when two projects share a timestamp.
// Entries that are not project ids are skipped: the NAS adds folders such as @eaDir,
// and a stray file there should not hide every project.
export const listProjects = async (dataDir: string): Promise<Project[]> => {
	let names: string[];

	try {
		names = await fs.readdir(path.join(dataDir, PROJECTS_DIR));
	} catch (error) {
		if (isEnoent(error)) {
			return [];
		}

		throw error;
	}

	const projects = await Promise.all(
		names.filter(isProjectId).map((name) => readStoredProject(path.join(dataDir, PROJECTS_DIR, name), name)),
	);

	return projects.sort(
		(left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
	);
};

// Writes the project under incoming/ and renames it into projects/ once the file is complete,
// so a crash never leaves a project the list would try to read.
export const createProject = async (dataDir: string, name: string, writeProject: WriteProject = writeJsonFile): Promise<Project> => {
	const project: Project = {
		id: randomUUID(),
		name,
		createdAt: new Date().toISOString(),
	};
	const staged = path.join(dataDir, INCOMING_DIR, project.id);

	await fs.mkdir(staged, { recursive: true });

	try {
		await writeProject(path.join(staged, PROJECT_FILE), project);
		await fs.mkdir(path.join(dataDir, PROJECTS_DIR), { recursive: true });
		await fs.rename(staged, projectDirectory(dataDir, project.id));
	} catch (error) {
		await removeDirectoryQuietly(staged);

		throw error;
	}

	return project;
};
