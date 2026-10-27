# Explicit opt-in cleanup. Run ONLY after the new project has passed your tests.
param(
    [Parameter(Mandatory=$true)][string]$OldProject,
    [switch]$Apply
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $OldProject -PathType Container)) {
    throw "Папка не найдена: $OldProject"
}
$projectPath = (Resolve-Path -LiteralPath $OldProject).Path
if ($projectPath.Length -lt 20 -or $projectPath -match '^[a-zA-Z]:\\?$') {
    throw 'Небезопасный путь. Очистка остановлена.'
}

# Only known generated backup folders and downloaded update archives.
$items = @(
    Get-ChildItem -LiteralPath $projectPath -Directory |
        Where-Object { $_.Name -like 'backup*' }
    Get-ChildItem -LiteralPath $projectPath -File |
        Where-Object { $_.Name -match '^Canon-Studio.*\.zip$|^INSTALL[-_].*\.txt$|^README-v[0-9.]+\.txt$' }
)
if ($items.Count -eq 0) {
    Write-Host 'Мусорных архивов и резервных папок не найдено.'
    exit 0
}
Write-Host ('Найдены элементы: ' + $items.Count) -ForegroundColor Yellow
$items | ForEach-Object { Write-Host $_.FullName }
if (-not $Apply) {
    Write-Host 'Это предварительный просмотр. Добавь -Apply для удаления.' -ForegroundColor Yellow
    exit 0
}
$items | Remove-Item -Recurse -Force
Write-Host 'Удалены только перечисленные элементы. Исходные src/public и пакетные файлы не тронуты.'
