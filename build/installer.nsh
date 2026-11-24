; Custom NSIS installer script for Handover
; Adds a progress bar during file extraction

!include "MUI2.nsh"
!include "nsDialogs.nsh"

; Show installation progress details by default
ShowInstDetails show
ShowUninstDetails show

; Always install for the current user only (REL-2): skip the "Anyone who uses
; this computer" choice, which would need administrator rights.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

; Override the instfiles page to show a detailed progress bar
!macro customInstall
  ; electron-builder's NSIS template copies the whole installer (about 627 MB) to
  ; %LOCALAPPDATA%\handover-updater\installer.exe for its auto-updater. This build
  ; has no auto-update, so the copy is only wasted disk space: delete it now.
  RMDir /r "$LOCALAPPDATA\handover-updater"
  DetailPrint "Installation complete."
!macroend

; The same folder is removed again on uninstall (a copy left by an older build).
; Recordings in %LOCALAPPDATA%\Handover and settings in %APPDATA%\Handover are not touched.
!macro customUnInstall
  RMDir /r "$LOCALAPPDATA\handover-updater"
!macroend
