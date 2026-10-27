import { state } from './state.js';

export const MAX_FILE = 20 * 1024 * 1024;
export const speedOf = { draft: 'fast', standard: 'balanced', high: 'detailed' };
export const qualityOf = { fast: 'draft', balanced: 'standard', detailed: 'high' };
export const presets = { economy: -30, normal: 0, rich: 25 };
export const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'tif', 'tiff']);
export const OFFICE_EXT = new Set(['docx', 'doc', 'txt', 'rtf', 'odt', 'xlsx', 'xls', 'ods', 'csv', 'pptx', 'ppt', 'odp']);
export const extOf = (name) => String(name || '').split('.').pop().toLowerCase();
export const kindOf = (name) => extOf(name) === 'pdf' ? 'pdf' : IMAGE_EXT.has(extOf(name)) ? 'image' : OFFICE_EXT.has(extOf(name)) ? 'office' : null;
export const isPDF = () => !!state.chosenFile && kindOf(state.chosenFile.name) === 'pdf';
export const isOffice = () => !!state.chosenFile && kindOf(state.chosenFile.name) === 'office';
export const isDocument = () => isPDF() || isOffice();
export const isJPEG = () => !!state.chosenFile && kindOf(state.chosenFile.name) === 'image';
