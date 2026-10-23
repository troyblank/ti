import 'dotenv/config';

import { prepareDocumentStorage } from './api/documents/index.ts';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();

await prepareDocumentStorage(config.dataDir);

const app = createApp(config);

const server = app.listen(config.port, config.host, () => {
	console.log(`🚀 TI API listening on http://${config.host}:${config.port}`);
	console.log(`Uploaded PDFs are stored in ${config.dataDir}`);
});

const shutdown = (signal: NodeJS.Signals) => {
	console.log(`${signal} received, shutting down.`);
	server.close(() => process.exit(0));
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
