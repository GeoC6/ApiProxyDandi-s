@echo off
title API Autoservicio - Test
echo ========================================
echo   API AUTOSERVICIO - MODO PRUEBA
echo ========================================
echo.

REM Verificar Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Node.js no está instalado
    pause
    exit /b 1
)

echo ✅ Node.js detectado
echo.

REM Verificar archivos
echo 🔍 Verificando archivos...
if not exist "main.js" (
    echo ❌ main.js no encontrado
    pause
    exit /b 1
)
if not exist "server.js" (
    echo ❌ server.js no encontrado
    pause
    exit /b 1
)

echo ✅ Archivos principales encontrados
echo.

REM Instalar dependencias si es necesario
if not exist "node_modules" (
    echo 📦 Instalando dependencias...
    npm install
    if errorlevel 1 (
        echo ❌ Error instalando dependencias
        pause
        exit /b 1
    )
)

echo ✅ Dependencias verificadas
echo.

REM Terminar procesos existentes
echo 🛑 Terminando procesos existentes...
taskkill /F /IM "API Autoservicio.exe" >nul 2>&1
taskkill /F /IM "electron.exe" >nul 2>&1
timeout /t 2 /nobreak >nul

echo.
echo 🚀 INICIANDO API AUTOSERVICIO EN MODO PRUEBA
echo.
echo 📍 INSTRUCCIONES:
echo    1. Busca el icono en la bandeja del sistema (abajo a la derecha)
echo    2. Click derecho en el icono para ver el menú (SIMPLIFICADO)
echo    3. Doble click para abrir la API en el navegador
echo.
echo 🌐 API estará disponible en: http://localhost:9000
echo 🔄 Para cerrar: Click derecho en el icono → Cerrar API
echo 💻 Para ver esta consola: Mantén esta ventana abierta
echo.
echo ⌨️ Presiona Ctrl+C aquí para terminar la prueba desde consola
echo.

REM Iniciar aplicación en modo desarrollo
echo Iniciando...
npm start