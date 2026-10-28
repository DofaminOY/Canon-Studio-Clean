param(
    [Parameter(Mandatory=$true)]
    [ValidatePattern('^https://[a-zA-Z0-9.-]+(?::443)?$')]
    [string]$SiteOrigin
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$env:CANON_STUDIO_ALLOWED_ORIGIN = $SiteOrigin.TrimEnd('/')
Write-Host "Agent разрешён для: $env:CANON_STUDIO_ALLOWED_ORIGIN"
Write-Host 'Проверьте, что домен действительно ваш. Ctrl+C остановит агент.'
npm start
