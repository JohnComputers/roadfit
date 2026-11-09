import { copyFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';

await access('dist/index.html', constants.R_OK);
await copyFile('dist/index.html', 'dist/404.html');
