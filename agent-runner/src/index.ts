import { main } from './main.js';

process.exitCode = await main({ env: process.env, cwd: process.cwd() });
