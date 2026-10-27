import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

// Adapter for Windows Print Spooler. Keep PowerShell quoting here.

export function psQuote(value) { return `'${String(value).replaceAll("'", "''")}'`; }

export function cmd(file, args, timeout = 20000) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => error ? reject(new Error(String(stderr || error.message).trim())) : resolve(stdout.trim()));
  });
}

export async function powershell(script) {
  if (process.platform !== 'win32') throw Error('Для очереди Windows необходим компьютер с Windows.');
  return cmd('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $ErrorActionPreference="Stop"; ' + script]);
}

export function asArray(output) {
  if (!output) return [];
  const parsed = JSON.parse(output);
  return (Array.isArray(parsed) ? parsed : [parsed]).filter(Boolean);
}

export async function getPrinters() {
  const list = asArray(await powershell('Get-Printer | Select-Object -ExpandProperty Name | ConvertTo-Json -Compress'));
  return list.filter((name) => typeof name === 'string' && /^Canon TS5350i series(?: HTTP)?$/i.test(name));
}

export async function getJobs(printer) {
  const output = await powershell(
    `@(Get-PrintJob -PrinterName ${psQuote(printer)} | Select-Object ID,DocumentName,JobStatus,TotalPages,PagesPrinted,Size) | ConvertTo-Json -Compress -Depth 4`,
  );
  return asArray(output).map((j) => ({
    id: Number(j.ID), document: String(j.DocumentName || 'Документ'),
    status: String(j.JobStatus || 'В очереди'), totalPages: Number(j.TotalPages || 0),
    pagesPrinted: Number(j.PagesPrinted || 0), size: Number(j.Size || 0),
  })).filter((j) => Number.isInteger(j.id));
}

export async function removeJob(printer, id) {
  await powershell(`Remove-PrintJob -PrinterName ${psQuote(printer)} -ID ${id} -Confirm:$false`);
}

export function getSumatra() {
  const candidates = [
    process.env.SUMATRA_PDF_PATH,
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'SumatraPDF', 'SumatraPDF.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'SumatraPDF', 'SumatraPDF.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'SumatraPDF.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'SumatraPDF', 'SumatraPDF.exe'),
    process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'SumatraPDF', 'SumatraPDF.exe'),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || 'SumatraPDF.exe';
}
