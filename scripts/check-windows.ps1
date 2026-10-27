# Run from Windows PowerShell: .\scripts\check-windows.ps1
$ErrorActionPreference = 'Continue'
Write-Host 'Canon Studio: проверка окружения' -ForegroundColor Cyan
Write-Host ('Node: ' + (& node --version 2>&1))
Write-Host ('npm: ' + (& npm --version 2>&1))

try {
    $service = Get-Service Spooler -ErrorAction Stop
    Write-Host ('Spooler: ' + $service.Status)
} catch {
    Write-Warning ('Не удалось прочитать службу печати: ' + $_.Exception.Message)
}

try {
    Get-Printer -ErrorAction Stop | Where-Object { $_.Name -like '*TS5350i*' } |
        Select-Object -ExpandProperty Name
} catch {
    Write-Warning ('Не удалось получить список принтеров: ' + $_.Exception.Message)
}

$poppler = Get-Command pdftoppm -ErrorAction SilentlyContinue
if (-not $poppler -and $env:POPPLER_BIN) {
    $poppler = Get-Item (Join-Path $env:POPPLER_BIN 'pdftoppm.exe') -ErrorAction SilentlyContinue
}
if (-not $poppler) {
    $found = Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter pdftoppm.exe -File -ErrorAction SilentlyContinue |
        Select-Object -First 1
    $poppler = $found
}
if ($poppler) { Write-Host ('Poppler: ' + $(if ($poppler.Source) { $poppler.Source } else { $poppler.FullName })) }
else { Write-Warning 'Poppler не найден. winget install -e --id oschwartz10612.Poppler' }

$sumatra = Get-Command SumatraPDF.exe -ErrorAction SilentlyContinue
if ($sumatra) { Write-Host ('SumatraPDF: ' + $sumatra.Source) }
else { Write-Host 'SumatraPDF: проверь установку и SUMATRA_PDF_PATH' }

Write-Host 'Примечание: успешная проверка среды не подтверждает физическую печать.'
