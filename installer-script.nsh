Function .onInstSuccess
    ; Agregar entrada al registro para auto-start AUTOMÁTICAMENTE
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "API Autoservicio" '"$INSTDIR\API Autoservicio.exe"'
    
    ; Mostrar mensaje de confirmación
    MessageBox MB_ICONINFORMATION "✅ API Autoservicio instalado correctamente.$\n$\nSe iniciará automáticamente con Windows."
FunctionEnd