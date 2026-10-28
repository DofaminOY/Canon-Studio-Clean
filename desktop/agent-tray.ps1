# Canon Studio Agent launcher/tray. Shipped with the Windows installer.
# Runs from a normal user account; no public listening socket or admin rights required.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName Microsoft.VisualBasic

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$node = Join-Path $root 'runtime\node.exe'
if (-not (Test-Path $node)) {
    [System.Windows.Forms.MessageBox]::Show('Не найден runtime\node.exe. Переустановите Canon Studio Agent.', 'Canon Studio') | Out-Null
    exit 1
}

$created = $false
$mutex = [System.Threading.Mutex]::new($true, 'Local\CanonStudioAgentTray', [ref]$created)
if (-not $created) { exit 0 }

$configDir = Join-Path $env:APPDATA 'CanonStudioAgent'
New-Item -ItemType Directory -Force -Path $configDir | Out-Null
$configFile = Join-Path $configDir 'settings.json'
$site = 'https://canon-studio-clean.vercel.app'
if (-not (Test-Path $configFile)) {
    $inputIP = [Microsoft.VisualBasic.Interaction]::InputBox(
        'Укажите IPv4-адрес вашего Canon в Wi-Fi (например, 192.168.1.20). Если принтер подключён только через USB, оставьте поле пустым.',
        'Первый запуск Canon Studio Agent', '')
    $ip = '127.0.0.1'
    if ($inputIP.Trim() -ne '') {
        $parsed = $null
        if (-not ([System.Net.IPAddress]::TryParse($inputIP.Trim(), [ref]$parsed) -and
            $parsed.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork)) {
            [System.Windows.Forms.MessageBox]::Show('Неверный IPv4-адрес. Можно настроить его позже.', 'Canon Studio') | Out-Null
        } else { $ip = $parsed.ToString() }
    }
    @{ printerIP = $ip; allowedSite = $site } | ConvertTo-Json | Set-Content -Encoding UTF8 $configFile
}
$settings = Get-Content $configFile -Raw | ConvertFrom-Json
$env:CANON_IP = [string]$settings.printerIP
$env:CANON_STUDIO_ALLOWED_ORIGIN = [string]$settings.allowedSite
$env:CANON_STUDIO_PORT = '3177'
$env:POPPLER_BIN = [string]$env:POPPLER_BIN

# Only this tray process owns its spawned Node process.
$ownsProcess = $false
$agentProcess = $null
$logPath = Join-Path $configDir 'agent.log'
$errorPath = Join-Path $configDir 'agent-error.log'
try {
    $existing = $null
    try { $existing = Invoke-RestMethod -Uri 'http://127.0.0.1:3177/api/health' -TimeoutSec 2 } catch { }
    if ($existing -and $existing.service -eq 'canon-studio-agent') {
        [System.Windows.Forms.MessageBox]::Show('Canon Studio уже запущена. Закройте другой экземпляр перед запуском агента.', 'Canon Studio') | Out-Null
        exit 0
    }
    $agentProcess = Start-Process -FilePath $node -ArgumentList 'src/index.js' -WorkingDirectory $root -PassThru -WindowStyle Hidden -RedirectStandardOutput $logPath -RedirectStandardError $errorPath
    $ownsProcess = $true

    $tray = New-Object System.Windows.Forms.NotifyIcon
    $tray.Icon = [System.Drawing.SystemIcons]::Application
    $tray.Text = 'Canon Studio Agent'
    $menu = New-Object System.Windows.Forms.ContextMenuStrip
    $open = $menu.Items.Add('Открыть Canon Studio')
    $open.Add_Click({ Start-Process 'http://127.0.0.1:3177' })
    $web = $menu.Items.Add('Открыть сайт Canon Studio')
    $web.Add_Click({ Start-Process 'https://canon-studio-clean.vercel.app' })
    $settingsMenu = $menu.Items.Add('Настройки подключения')
    $settingsMenu.Add_Click({ Start-Process 'notepad.exe' -ArgumentList ('"' + $configFile + '"') })
    $diagnostic = $menu.Items.Add('Проверить службу печати')
    $diagnostic.Add_Click({
        $service = Get-Service -Name Spooler -ErrorAction SilentlyContinue
        $status = if ($service) { [string]$service.Status } else { 'Не найдена' }
        [System.Windows.Forms.MessageBox]::Show('Windows Spooler: ' + $status, 'Canon Studio') | Out-Null
    })
    $null = $menu.Items.Add('-')
    $quit = $menu.Items.Add('Выйти и остановить Agent')
    $script:running = $true
    $quit.Add_Click({ $script:running = $false })
    $tray.ContextMenuStrip = $menu
    $tray.Visible = $true
    $tray.Add_DoubleClick({ Start-Process 'http://127.0.0.1:3177' })
    Start-Process 'http://127.0.0.1:3177'
    while ($script:running -and -not $agentProcess.HasExited) {
        [System.Windows.Forms.Application]::DoEvents()
        Start-Sleep -Milliseconds 150
    }
    if ($agentProcess.HasExited) {
        [System.Windows.Forms.MessageBox]::Show('Agent остановился. Проверьте файл ' + $errorPath, 'Canon Studio') | Out-Null
    }
} catch {
    [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Ошибка Canon Studio Agent') | Out-Null
} finally {
    if ($tray) { $tray.Visible = $false; $tray.Dispose() }
    if ($ownsProcess -and $agentProcess -and -not $agentProcess.HasExited) {
        Stop-Process -Id $agentProcess.Id -ErrorAction SilentlyContinue
    }
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
