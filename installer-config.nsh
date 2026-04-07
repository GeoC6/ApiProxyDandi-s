; installer-config.nsh - Configuración simplificada del instalador
; Auto-start automático sin opciones de usuario

; Configuraciones del instalador
RequestExecutionLevel user

; Información del producto
!ifndef PRODUCT_WEB_SITE
!define PRODUCT_WEB_SITE "http://localhost:9000"
!endif

!ifndef PRODUCT_UNINST_ROOT_KEY
!define PRODUCT_UNINST_ROOT_KEY "HKCU"
!endif

; Configuraciones específicas de auto-start automático
!define AUTOSTART_ENABLED true
!define AUTOSTART_REGKEY "Software\Microsoft\Windows\CurrentVersion\Run"
!define AUTOSTART_REGVALUE "API Autoservicio"