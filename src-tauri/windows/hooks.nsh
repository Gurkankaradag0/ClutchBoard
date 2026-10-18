; Before 0.3.0 the app was named "Valo Tracker". The installer keys installs and shortcuts by product
; name, so that install is a separate app with its own folder. ClutchBoard goes next to it (not into
; it: its uninstaller deletes uninstall.exe there), takes over its shortcuts and then removes it.
; App data is never touched by a silent uninstall.

!define OLD_UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Valo Tracker"

; Folder of a previous ClutchBoard install that moved, cleaned up after install.
Var MovedFrom

!macro NSIS_HOOK_PREINSTALL
  ReadRegStr $0 HKCU "${OLD_UNINSTKEY}" "InstallLocation"
  ${If} $0 != ""
    ; Stored quoted: "E:\Program Files\Valo Tracker"
    StrCpy $1 $0 1
    ${If} $1 == '"'
      StrCpy $0 $0 -1 1
    ${EndIf}
    ${GetParent} $0 $1
    StrCpy $1 "$1\${PRODUCTNAME}"
    ${If} $1 != $INSTDIR
      StrCpy $MovedFrom $INSTDIR
      StrCpy $INSTDIR $1
      CreateDirectory $INSTDIR
      SetOutPath $INSTDIR
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} $MovedFrom != ""
    Delete "$MovedFrom\${MAINBINARYNAME}.exe"
    Delete "$MovedFrom\uninstall.exe"
    RMDir "$MovedFrom"
  ${EndIf}

  ReadRegStr $0 HKCU "${OLD_UNINSTKEY}" "UninstallString"
  ${If} $0 != ""
    ; Also repoints shortcuts that still target the moved folder.
    ${If} ${FileExists} "$DESKTOP\Valo Tracker.lnk"
    ${OrIf} ${FileExists} "$DESKTOP\${PRODUCTNAME}.lnk"
      CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    ${EndIf}
    CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Exec '$0 /S'
  ${EndIf}
!macroend

; App data lives in ClutchBoard folders (tauri.conf appDirectoriesOverride), not in the
; identifier folders the default "delete app data" option removes.
!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    SetShellVarContext current
    RmDir /r "$APPDATA\${PRODUCTNAME}"
    RmDir /r "$LOCALAPPDATA\${PRODUCTNAME}\WebView"
    RmDir /r "$LOCALAPPDATA\${PRODUCTNAME}\Cache"
    RmDir /r "$LOCALAPPDATA\${PRODUCTNAME}\Logs"
    RMDir "$LOCALAPPDATA\${PRODUCTNAME}"
  ${EndIf}
!macroend
