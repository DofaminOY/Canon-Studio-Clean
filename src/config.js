import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

// All network operations remain local to this computer.
export const HOST = '127.0.0.1';
export const PORT = Number(process.env.CANON_STUDIO_PORT || 3177);
export const PRINTER_IP = process.env.CANON_IP || '192.168.2.28';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TOKEN = randomUUID();
export const MAX_TASKS = 15;
export const MAX_RASTER_SHEETS = 40;
