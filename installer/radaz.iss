#ifndef ProductVersion
  #error ProductVersion is required
#endif
[Setup]
AppId={{A7B6BDE2-3113-47E2-8D07-5137F002928B}
AppName=RADAZ
AppVersion={#ProductVersion}
AppPublisher=RADAZ
DefaultDirName={localappdata}\Programs\RADAZ
DefaultGroupName=RADAZ
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=..\outputs\releases
OutputBaseFilename=RADAZ-Setup-v{#ProductVersion}
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\radaz.ico
SetupIconFile=..\outputs\desktop-stage\public\radaz.ico
CloseApplications=no
CreateUninstallRegKey=RegisterUninstaller

[Files]
Source: "..\outputs\desktop-stage\*"; DestDir: "{app}\versions\{#ProductVersion}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "launcher.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\outputs\desktop-stage\public\radaz.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autodesktop}\RADAZ"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\launcher.ps1"""; WorkingDir: "{app}"; IconFilename: "{app}\radaz.ico"; Comment: "RADAZ - DICOM Viewer"; AppUserModelID: "RADAZ.DICOM"; Check: WantShortcuts
Name: "{autoprograms}\RADAZ"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\launcher.ps1"""; WorkingDir: "{app}"; IconFilename: "{app}\radaz.ico"; Comment: "RADAZ - DICOM Viewer"; AppUserModelID: "RADAZ.DICOM"; Check: WantShortcuts
Name: "{userstartup}\RADAZ"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\launcher.ps1"""; WorkingDir: "{app}"; IconFilename: "{app}\radaz.ico"; Comment: "RADAZ - DICOM Viewer"; AppUserModelID: "RADAZ.DICOM"; Check: WantStartup

[Run]
Filename: "{app}\versions\{#ProductVersion}\runtime\python\python.exe"; Parameters: """{app}\versions\{#ProductVersion}\bridge\radaz_desktop.py"" initialize --install-root ""{app}"" --no-shortcuts --start-background"; Flags: runhidden waituntilterminated
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\launcher.ps1"""; Description: "RADAZ proqramini ac"; Flags: postinstall nowait skipifsilent runhidden

; No recursive uninstall-delete rules: clinical data and rollback versions are preserved.

[Code]
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ExitCode: Integer;
begin
  if CurUninstallStep <> usUninstall then Exit;
  if not ExecWithNativeSysDir(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    ExpandConstant('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{app}\launcher.ps1" -Uninstall'),
    '', SW_HIDE, ewWaitUntilTerminated, ExitCode) then ExitCode := -1;
  Log(Format('RADAZ shutdown exit code: %d', [ExitCode]));
  if ExitCode <> 0 then begin
    SuppressibleMsgBox('RADAZ services could not be stopped. No program files were removed. See logs\update-errors.jsonl and retry.', mbError, MB_OK, IDOK);
    Abort;
  end;
end;

function RegisterUninstaller: Boolean;
begin
  Result := ExpandConstant('{param:NoRegistry|0}') <> '1';
end;

function WantShortcuts: Boolean;
begin
  Result := ExpandConstant('{param:NoShortcuts|0}') <> '1';
end;

function WantStartup: Boolean;
begin
  Result := ExpandConstant('{param:NoStartup|0}') <> '1';
end;
