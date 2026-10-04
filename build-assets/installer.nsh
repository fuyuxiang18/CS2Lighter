!include WinVer.nsh

; Cache files are user data. Electron-builder's default uninstaller removes the
; entire installation directory, including on upgrades. Keep demodata in place
; while retaining its atomic rollback behavior for application files.
!ifdef BUILD_UNINSTALLER
Function un.moveApplicationFiles
  Exch $R0
  Push $R1
  Push $R2
  Push $R3
  StrCpy $R3 "$INSTDIR$R0\*.*"
  FindFirst $R1 $R2 $R3
  loop:
    StrCmp $R2 "" doneSuccess
    StrCmp $R2 "." next
    StrCmp $R2 ".." next
    ${If} $R0 == ""
      StrCmp $R2 "demodata" next
    ${EndIf}
    IfFileExists "$INSTDIR$R0\$R2\*.*" directory file
    directory:
      CreateDirectory "$PLUGINSDIR\old-install$R0\$R2"
      Push "$R0\$R2"
      Call un.moveApplicationFiles
      Pop $R3
      ${If} $R3 != 0
        Goto done
      ${EndIf}
      Goto next
    file:
      ClearErrors
      Rename "$INSTDIR$R0\$R2" "$PLUGINSDIR\old-install$R0\$R2"
      ${If} $R0 == ""
        ${AndIf} $R2 == "Uninstall ${PRODUCT_FILENAME}.exe"
        ClearErrors
      ${EndIf}
      IfErrors 0 next
      StrCpy $R3 "$INSTDIR$R0\$R2"
      Goto done
    next:
      FindNext $R1 $R2
      Goto loop
    doneSuccess:
      StrCpy $R3 0
    done:
      FindClose $R1
      StrCpy $R0 $R3
      Pop $R3
      Pop $R2
      Pop $R1
      Exch $R0
FunctionEnd
!endif

!macro customRemoveFiles
  ${If} ${isUpdated}
    CreateDirectory "$PLUGINSDIR\old-install"
    Push ""
    Call un.moveApplicationFiles
    Pop $R0
    ${If} $R0 != 0
      DetailPrint "File is busy, aborting: $R0"
      Push ""
      Call un.restoreFiles
      Pop $R0
      Abort "Unable to replace application files. Close CS2Lighter and try again."
    ${EndIf}
  ${EndIf}
  SetOutPath $TEMP
  FindFirst $R1 $R2 "$INSTDIR\*.*"
  removeNext:
    StrCmp $R2 "" removeDone
    StrCmp $R2 "." keepEntry
    StrCmp $R2 ".." keepEntry
    StrCmp $R2 "demodata" keepEntry
    IfFileExists "$INSTDIR\$R2\*.*" removeDirectory removeFile
    removeDirectory:
      RMDir /r "$INSTDIR\$R2"
      Goto keepEntry
    removeFile:
      Delete "$INSTDIR\$R2"
    keepEntry:
      FindNext $R1 $R2
      Goto removeNext
  removeDone:
    FindClose $R1
    ; Only succeeds if no user cache remains.
    RMDir "$INSTDIR"
!macroend

!macro customInit
  ${IfNot} ${AtLeastWin10}
    MessageBox mb_iconStop "Windows 10+ is required."
    Abort
  ${EndIf}
!macroend

!macro customInstall
  ; Adds the installation folder to the PATH env variable if it's not already there.
  ; It avoids additional steps on Windows to run the CLI.
  nsExec::Exec 'echo %PATH% | find "$INSTDIR"'
  Pop $0
  ; Not in the PATH variable, add it
  ${If} $0 = 0
    EnVar::SetHKCU
    EnVar::AddValue "PATH" "$INSTDIR"
    Pop $0
    ${If} $0 != 0
      MessageBox MB_OK "Unable to add $INSTDIR to PATH"
    ${EndIf}
  ${EndIf}
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; Delete the installation folder from the PATH env variable
    EnVar::SetHKCU
    EnVar::DeleteValue "PATH" "$INSTDIR"
    Pop $0
    ${If} $0 != 0
        MessageBox MB_OK "Unable to delete $INSTDIR to PATH"
    ${EndIf}

    ; Keep all user demo/database/settings folders. This fork must never remove upstream CSDM data.
  ${endIf}
!macroend
