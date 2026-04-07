@echo off
title API Autoservicio - Build con Auto-Start Automático
echo ==========================================
echo   API AUTOSERVICIO - BUILD ACTUALIZADO
echo   CON AUTO-START AUTOMÁTICO
echo ==========================================
echo.

REM Verificar Node.js
echo 🔍 Verificando Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Node.js no está instalado
    pause
    exit /b 1
)

echo ✅ Node.js: 
node --version
echo.

REM Limpiar builds anteriores
echo 🧹 Limpiando builds anteriores...
if exist "dist" rmdir /s /q "dist"
echo.

REM Verificar archivos
echo 🔍 Verificando archivos...
if not exist "main.js" (
    echo ❌ main.js no encontrado
    pause
    exit /b 1
)
if not exist "package.json" (
    echo ❌ package.json no encontrado
    pause
    exit /b 1
)
if not exist "installer-script.nsh" (
    echo ❌ installer-script.nsh no encontrado
    pause
    exit /b 1
)
echo ✅ Archivos principales OK
echo.

REM Verificar/instalar dependencias
echo 📦 Instalando dependencias necesarias...
echo    (Esto puede tomar unos minutos la primera vez)
npm install
if errorlevel 1 (
    echo ❌ Error instalando dependencias base
    pause
    exit /b 1
)
echo ✅ Dependencias base instaladas
echo.

REM Instalar Electron específicamente
echo ⚡ Instalando Electron y electron-builder...
npm install --save-dev electron@latest electron-builder@latest
if errorlevel 1 (
    echo ❌ Error instalando Electron
    pause
    exit /b 1
)
echo ✅ Electron instalado
echo.

REM Verificar que Electron funciona
echo 🔍 Verificando instalación de Electron...
npx electron --version
if errorlevel 1 (
    echo ❌ Electron no funciona correctamente
    echo 💡 Intentando reinstalar...
    npm uninstall electron electron-builder
    npm install --save-dev electron electron-builder
    if errorlevel 1 (
        echo ❌ No se pudo arreglar Electron
        pause
        exit /b 1
    )
)
echo ✅ Electron funcionando
echo.

REM Mostrar versiones para debug
echo 📋 Versiones instaladas:
echo Node: 
node --version
echo NPM: 
npm --version
echo Electron: 
npx electron --version
echo.

REM Mostrar información sobre auto-start
echo ⚙️ CONFIGURACIÓN AUTO-START:
echo   ✅ Auto-start se habilitará AUTOMÁTICAMENTE al instalar
echo   ✅ NO se preguntará al usuario durante la instalación
echo   ✅ La aplicación SIEMPRE se iniciará con Windows
echo   ✅ NO hay opciones en el menú para deshabilitar auto-start
echo   ✅ Solo se puede deshabilitar manualmente desde Windows
echo.

REM Construir aplicación
echo 🏗️ Iniciando construcción...
echo    📦 Empaquetando aplicación con auto-start automático...
echo    🖥️ Creando instalador Windows...
echo    ⏱️ Esto tomará varios minutos...
echo.

REM Ejecutar build con más información de debug
npm run build
set BUILD_RESULT=%errorlevel%

echo.
if %BUILD_RESULT% neq 0 (
    echo ❌ Error en el build (código: %BUILD_RESULT%)
    echo.
    echo 💡 Soluciones posibles:
    echo    1. Ejecutar como administrador
    echo    2. Cerrar antivirus temporalmente
    echo    3. Verificar que no haya espacios en la ruta
    echo    4. Intentar build manual: npm run build-dir
    echo.
    echo 🔧 ¿Intentar build solo de directorio? (s/n)
    set /p choice=
    if /i "%choice%"=="s" (
        echo.
        echo 📁 Intentando build de directorio...
        npm run build-dir
        if errorlevel 1 (
            echo ❌ Build de directorio también falló
        ) else (
            echo ✅ Build de directorio exitoso
            echo 📁 Revisa la carpeta dist/
        )
    )
    pause
    exit /b %BUILD_RESULT%
)

echo ==========================================
echo   🎉 BUILD COMPLETADO EXITOSAMENTE
echo   ✅ AUTO-START AUTOMÁTICO CONFIGURADO
echo ==========================================
echo.

REM Verificar archivos generados
if exist "dist" (
    echo 📁 Archivos en dist/:
    dir "dist" /b
    echo.
    
    if exist "dist\*.exe" (
        echo ✅ Instalador encontrado:
        for %%f in ("dist\*.exe") do echo    📦 %%~nxf
        echo.
        echo 🚀 CARACTERÍSTICAS DEL INSTALADOR:
        echo    ✅ Habilita auto-start automáticamente
        echo    ✅ NO pregunta opciones al usuario
        echo    ✅ Se ejecuta después de instalar
        echo    ✅ Crea accesos directos
        echo    ✅ Aplicación siempre disponible en system tray
        echo    ✅ Auto-start NO se puede deshabilitar desde la app
        echo    ✅ Solo se puede deshabilitar desde Windows manualmente
    )
    
    if exist "dist\win-unpacked" (
        echo ✅ Aplicación desempaquetada disponible
    )
    
    echo.
    echo 🚀 Para probar: dist\win-unpacked\API Autoservicio.exe
    echo 📦 Para distribuir: dist\*.exe
    echo ⚠️ IMPORTANTE: El instalador configurará auto-start automáticamente
    echo ⚠️ NO habrá opciones para el usuario - siempre se inicia con Windows
    echo.
    
    set /p choice="¿Abrir carpeta dist? (s/n): "
    if /i "%choice%"=="s" start explorer "dist"
) else (
    echo ❌ No se generó carpeta dist
)

echo.
echo 📝 INSTRUCCIONES POST-INSTALACIÓN:
echo   1. El instalador habilitará auto-start automáticamente
echo   2. La aplicación aparecerá en la bandeja del sistema
echo   3. Se reiniciará automáticamente con Windows
echo   4. No hay opciones para deshabilitar desde la aplicación
echo   5. Para deshabilitar manualmente (si es necesario):
echo      reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "API Autoservicio" /f
echo.
pause