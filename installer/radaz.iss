#ifndef ProductVersion
  #error ProductVersion is required
#endif
#ifndef StageRoot
  #define StageRoot "..\outputs\desktop-stage"
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
SetupIconFile={#StageRoot}\public\radaz.ico
CloseApplications=no
CreateUninstallRegKey=RegisterUninstaller

[Files]
Source: "{#StageRoot}\runtime\RadazTls.exe"; Flags: dontcopy
Source: "{#StageRoot}\*"; DestDir: "{app}\versions\{#ProductVersion}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#StageRoot}\runtime\RadazStart.exe"; DestDir: "{app}"; DestName: "RADAZ-Start.exe"; Flags: ignoreversion
Source: "launcher.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StageRoot}\public\radaz.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autodesktop}\RADAZ"; Filename: "{app}\RADAZ-Start.exe"; WorkingDir: "{app}"; IconFilename: "{app}\radaz.ico"; Comment: "RADAZ - DICOM Viewer"; AppUserModelID: "RADAZ.DICOM"; Check: WantShortcuts
Name: "{autoprograms}\RADAZ"; Filename: "{app}\RADAZ-Start.exe"; WorkingDir: "{app}"; IconFilename: "{app}\radaz.ico"; Comment: "RADAZ - DICOM Viewer"; AppUserModelID: "RADAZ.DICOM"; Check: WantShortcuts
Name: "{userstartup}\RADAZ"; Filename: "{app}\RADAZ-Start.exe"; WorkingDir: "{app}"; IconFilename: "{app}\radaz.ico"; Comment: "RADAZ - DICOM Viewer"; AppUserModelID: "RADAZ.DICOM"; Check: WantStartup

[Run]
Filename: "{app}\versions\{#ProductVersion}\runtime\python\python.exe"; Parameters: """{app}\versions\{#ProductVersion}\bridge\radaz_desktop.py"" initialize --install-root ""{app}"" --no-shortcuts --start-background"; Flags: runhidden waituntilterminated
Filename: "{app}\RADAZ-Start.exe"; Description: "RADAZ proqramini ac"; Flags: postinstall nowait skipifsilent runhidden

; No recursive uninstall-delete rules: clinical data and rollback versions are preserved.

[Code]
procedure InitializeWizard;
var
  Page: TOutputProgressWizardPage;
  Helper, Args, Mode, LogsDir: String;
  Code: Integer;
begin
  Page := CreateOutputProgressPage('RADAZ DICOM Viewer', 'Quraşdırma hazırlanır');
  Page.Show;
  try
    Page.SetText('Windows uyğunluğu yoxlanılır...', '');
    Page.SetProgress(1, 5);
    try
      ExtractTemporaryFile('RadazTls.exe');
      Helper := ExpandConstant('{tmp}\RadazTls.exe');
      LogsDir := ExpandConstant('{localappdata}\RADAZ\logs');
      Page.SetText('Təhlükəsizlik sertifikatları yoxlanılır...', '');
      Page.SetProgress(2, 5);
      Mode := 'setup';
      if ExpandConstant('{param:SSLDiagnosticsOnly|0}') = '1' then Mode := 'inspect';
      Page.SetText('Zərurət olduqda sertifikatlar yenilənir...', 'Windows administrator təsdiqi istəyə bilər.');
      Page.SetProgress(3, 5);
      Args := Mode + ' github.com "' + LogsDir + '"';
      if not Exec(Helper, Args, '', SW_HIDE, ewWaitUntilTerminated, Code) then Code := -1;
      Log(Format('Windows certificate preflight exit %d', [Code]));
      Page.SetText('HTTPS bağlantısı yoxlanılır...', '');
      Page.SetProgress(4, 5);
      if not Exec(Helper, 'diagnose radaz.space "' + LogsDir + '"', '', SW_HIDE, ewWaitUntilTerminated, Code) then Code := -1;
      Log(Format('HTTPS mirror status %d', [Code]));
    except
      Log('Windows TLS diagnostics unavailable: ' + GetExceptionMessage);
    end;
    Page.SetText('RADAZ DICOM Viewer quraşdırılır...', '');
    Page.SetProgress(5, 5);
  finally
    Page.Hide;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then WizardForm.StatusLabel.Caption := 'RADAZ DICOM Viewer quraşdırılır...';
end;
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ExitCode: Integer;
begin
  if CurUninstallStep <> usUninstall then Exit;
  if not Exec(ExpandConstant('{app}\RADAZ-Start.exe'), '--uninstall',
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
