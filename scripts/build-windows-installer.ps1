# Run this on Windows x64 after installing Node.js 22+ and Inno Setup 6.
# Produces dist\installer\CanonStudioAgent-Setup.exe. No changes to system PATH.
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -and $PSVersionTable.PSEdition -eq 'Core') { throw 'Для зборки потрібна Windows x64.' }
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root
$version = (& node -p 'process.versions.node').Trim()
if ([int]($version.Split('.')[0]) -lt 22) { throw 'Node.js 22+ required for packaging.' }
if ((& node -p 'process.arch').Trim() -ne 'x64') { throw 'Use Node.js x64 when packaging.' }
$stage = Join-Path $root 'dist\windows-agent'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'runtime') | Out-Null
foreach ($item in @('public','src','desktop')) { Copy-Item (Join-Path $root $item) (Join-Path $stage $item) -Recurse -Force }
foreach ($item in @('package.json','package-lock.json')) {
    if (-not (Test-Path (Join-Path $root $item))) { throw "Missing $item; run npm install locally first." }
    Copy-Item (Join-Path $root $item) (Join-Path $stage $item) -Force
}
$nodePath = (& node -p 'process.execPath').Trim()
Copy-Item $nodePath (Join-Path $stage 'runtime\node.exe') -Force
Push-Location $stage
try {
    & npm.cmd ci --omit=dev --no-audit
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
    & (Join-Path $stage 'runtime\node.exe') --check 'src\index.js'
    if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed' }
} finally { Pop-Location }
$compiler = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
    (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe')
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $compiler) { throw 'Install Inno Setup 6 to build the installer (ISCC.exe not found).' }
& $compiler (Join-Path $root 'installer\windows\CanonStudioAgent.iss')
if ($LASTEXITCODE -ne 0) { throw 'Inno Setup build failed' }
Write-Host ('Installer generated at ' + (Join-Path $root 'dist\installer\CanonStudioAgent-Setup.exe'))
