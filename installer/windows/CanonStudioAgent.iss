#define AgentName "Canon Studio Agent"
#define AgentVersion "1.0.0"
#define StageDir "..\..\dist\windows-agent"

[Setup]
AppId={{F7F0AF01-74F2-4688-ADE2-D52B3DB62038}
AppName={#AgentName}
AppVersion={#AgentVersion}
AppPublisher=Canon Studio Community
DefaultDirName={localappdata}\Programs\CanonStudioAgent
DefaultGroupName=Canon Studio
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\..\dist\installer
OutputBaseFilename=CanonStudioAgent-Setup
Compression=lzma2
SolidCompression=yes
UninstallDisplayIcon={app}\runtime\node.exe
WizardStyle=modern
DisableProgramGroupPage=yes

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Tasks]
Name: "desktopicon"; Description: "Создать ярлык на рабочем столе"; GroupDescription: "Ярлыки:"; Flags: unchecked

[Icons]
Name: "{autoprograms}\Canon Studio Agent"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\desktop\agent-tray.ps1"""; WorkingDir: "{app}"
Name: "{autodesktop}\Canon Studio Agent"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\desktop\agent-tray.ps1"""; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -STA -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\desktop\agent-tray.ps1"""; Description: "Запустить Canon Studio Agent"; Flags: postinstall nowait skipifsilent

