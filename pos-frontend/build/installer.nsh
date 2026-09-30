; Custom NSIS hooks for StoreX Restaurant — provisions the bundled PostgreSQL
; instance and registers it as a Windows service. The heavy lifting lives in
; install-postgres.ps1 / uninstall-postgres.ps1 which are extracted by
; electron-builder under $INSTDIR\resources\.

!macro customInstall
  DetailPrint "Setting up bundled PostgreSQL service..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\install-postgres.ps1" -InstallDir "$INSTDIR"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_ICONSTOP "PostgreSQL setup failed (exit code $0).$\r$\nCheck C:\ProgramData\StoreX Restaurant\logs\install.log for details.$\r$\nInstallation will be rolled back."
    Abort
  ${EndIf}
  DetailPrint "PostgreSQL service is running."

  ; Silent printing: a per-machine signing key, trusted by QZ Tray. Never fatal —
  ; without it the till still prints (QZ asks the cashier to allow it), and the
  ; script can be re-run by hand once QZ Tray is installed.
  DetailPrint "Setting up silent printing (QZ Tray signing)..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\setup-qz-signing.ps1" -InstallDir "$INSTDIR"'
  Pop $0
  ${If} $0 == 2
    DetailPrint "QZ Tray is not installed yet - install it, then re-run setup-qz-signing.ps1 as administrator."
  ${ElseIf} $0 != 0
    DetailPrint "QZ Tray signing was not set up (exit code $0). Printing will ask for permission. See C:\ProgramData\StoreX Restaurant\logs\qz-setup.log"
  ${EndIf}

  ; Start menu: re-trust QZ Tray without a command line — after QZ Tray is
  ; installed later, or reinstalled/upgraded and loses the certificate.
  ; perMachine, so $SMPROGRAMS is the all-users Start menu, beside the app.
  CreateShortCut "$SMPROGRAMS\StoreX Restaurant - Repair printing.lnk" \
    "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" \
    '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\resources\repair-printing.ps1"' \
    "$INSTDIR\StoreX Restaurant.exe" 0 SW_SHOWMINIMIZED "" "Set up silent receipt and kitchen printing again"
!macroend

!macro customUnInit
  ; An upgrade runs the old uninstaller (with --updated) and then copies the new
  ; files over $INSTDIR. The PostgreSQL service runs from $INSTDIR\resources, and
  ; Windows locks a running program's files — so without this the old files could
  ; not be removed and the new ones could not be written ("Error opening file for
  ; writing"). Stop it here, BEFORE anything is removed; the new version's
  ; install-postgres.ps1 starts it again on the new programs. The database itself
  ; (in ProgramData) is untouched. Stop-Service waits until it has stopped.
  ${if} ${isUpdated}
    nsExec::ExecToLog 'powershell.exe -NoProfile -Command "Stop-Service -Name StoreXRestaurantPostgres -Force -ErrorAction SilentlyContinue"'
    Pop $0
  ${endIf}
!macroend

!macro customUnInstall
  ; Our own Start menu entry; electron-builder removes only the shortcuts it made.
  ${ifNot} ${isUpdated}
    SetShellVarContext all
    Delete "$SMPROGRAMS\StoreX Restaurant - Repair printing.lnk"
  ${endIf}
  ; NOTE: by the time this macro runs, electron-builder's uninstaller has ALREADY
  ; done `RMDir /r $INSTDIR`, so the bundled uninstall-postgres.ps1 and pg_ctl.exe
  ; are gone — we cannot call them here. Do the teardown self-contained with sc.exe
  ; (always present on Windows). The database lives in C:\ProgramData\StoreX Restaurant\,
  ; outside $INSTDIR, so it survives unless we explicitly delete it below.
  ;
  ; Skip everything on an in-place upgrade (${isUpdated}): the new version's
  ; install-postgres.ps1 reconciles the existing service + cluster, so an upgrade
  ; must never prompt or tear anything down.
  ${ifNot} ${isUpdated}
    DetailPrint "Stopping PostgreSQL service..."
    nsExec::ExecToLog 'sc.exe stop StoreXRestaurantPostgres'
    Pop $0
    Sleep 2000

    ; Default to KEEP. /SD IDNO makes a silent uninstall keep data too.
    MessageBox MB_YESNO|MB_ICONQUESTION "Delete the StoreX Restaurant database (all sales, products, customers, settings)?$\r$\n$\r$\nChoose 'No' to keep your data and reuse it on a future reinstall.$\r$\n$\r$\nBackups in C:\ProgramData\StoreX Restaurant\backups are kept either way." /SD IDNO IDYES un_wipe IDNO un_keep

    un_wipe:
      DetailPrint "Removing PostgreSQL service and database..."
      nsExec::ExecToLog 'sc.exe delete StoreXRestaurantPostgres'
      Pop $0
      SetShellVarContext all   ; $APPDATA -> C:\ProgramData
      RMDir /r "$APPDATA\StoreX Restaurant\pgdata"
      Delete "$APPDATA\StoreX Restaurant\db.properties"
      Goto un_done

    un_keep:
      ; Keep the data, but still unregister the service so it isn't left pointing at
      ; the now-deleted binaries. The cluster + db.properties stay for a reinstall.
      DetailPrint "Removing PostgreSQL service (keeping database)..."
      nsExec::ExecToLog 'sc.exe delete StoreXRestaurantPostgres'
      Pop $0

    un_done:
      ; The files PostgreSQL held open survived electron-builder's RMDir above;
      ; with the service stopped and deleted they can go now.
      RMDir /r "$INSTDIR"
  ${endIf}
!macroend
