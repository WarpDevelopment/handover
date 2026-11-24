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
  DetailPrint "Installation complete."
!macroend
