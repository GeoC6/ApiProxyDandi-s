import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env') });

import { app, Tray, Menu, shell, dialog, nativeImage, BrowserWindow, ipcMain } from 'electron';
import { exec, execSync } from 'child_process';
import fs from 'fs';
import os from 'os';

import('./server.js');

let tray = null;
let isQuitting = false;
let logBuffer = [];
let configWindow = null;
let dashboardWindow = null;

const iconPath = join(__dirname, 'icono.ico');
const PORT = process.env.PORT || 9000;

function setupLogCapture() {
    const originalConsoleLog = console.log;
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;

    console.log = function (...args) {
        const message = args.join(' ');
        const timestamp = new Date().toISOString();
        logBuffer.push(`[${timestamp}] LOG: ${message}`);
        if (logBuffer.length > 500) logBuffer = logBuffer.slice(-500);
        originalConsoleLog.apply(console, args);
    };

    console.error = function (...args) {
        const message = args.join(' ');
        const timestamp = new Date().toISOString();
        logBuffer.push(`[${timestamp}] ERROR: ${message}`);
        if (logBuffer.length > 500) logBuffer = logBuffer.slice(-500);
        originalConsoleError.apply(console, args);
    };

    console.warn = function (...args) {
        const message = args.join(' ');
        const timestamp = new Date().toISOString();
        logBuffer.push(`[${timestamp}] WARN: ${message}`);
        if (logBuffer.length > 500) logBuffer = logBuffer.slice(-500);
        originalConsoleWarn.apply(console, args);
    };
}

setupLogCapture();

class APISystemTray {
    constructor() {
        this.initializeApp();
    }

    initializeApp() {
        app.setAppUserModelId('API Autoservicio');

        app.on('window-all-closed', (e) => {
            if (!isQuitting) e.preventDefault();
        });

        app.on('before-quit', () => {
            isQuitting = true;
        });

        app.whenReady().then(() => {
            this.createSystemTray();
            this.ensureAutoStartEnabled();
            this.showWelcomeNotification();

            ipcMain.on('open-config-window', () => {
                this.openConfigPanel();
            });
        });
    }

    createSystemTray() {
        const icon = this.loadIcon();
        tray = new Tray(icon);
        tray.setToolTip(`API Autoservicio - Puerto ${PORT}`);
        this.updateTrayMenu();

        tray.on('double-click', () => this.openDashboard());
        tray.on('click', () => tray.popUpContextMenu());
    }

    loadIcon() {
        try {
            if (fs.existsSync(iconPath)) {
                const icon = nativeImage.createFromPath(iconPath);
                if (!icon.isEmpty()) {
                    console.log('Icono cargado desde:', iconPath);
                    return icon;
                }
            }
        } catch (error) {
            console.log('Error cargando icono:', error.message);
        }
        console.log('Usando icono por defecto del sistema');
        const iconData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAFTSURBVDiNpZM9SwNBEIafgwQLwcJCG1sLwVqwsLGwsLBQsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCwsLGwsLCw==';
        return nativeImage.createFromDataURL(iconData);
    }

    isAutoStartEnabled() {
        if (process.platform !== 'win32') return false;
        try {
            const result = execSync(
                'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "API Autoservicio"',
                { encoding: 'utf8' }
            );
            return result.includes('API Autoservicio');
        } catch (error) {
            return false;
        }
    }

    ensureAutoStartEnabled() {
        if (process.platform !== 'win32') {
            console.log('Auto-start solo disponible en Windows');
            return;
        }
        try {
            const appPath = process.execPath;
            const command = `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "API Autoservicio" /d "${appPath}" /f`;
            exec(command, (error) => {
                if (error) console.log('No se pudo configurar auto-start:', error.message);
                else console.log('Auto-start configurado correctamente');
            });
        } catch (error) {
            console.log('Error configurando auto-start:', error.message);
        }
    }

    updateTrayMenu() {
        const autoStartEnabled = this.isAutoStartEnabled();

        const menu = Menu.buildFromTemplate([
            { label: 'API AUTOSERVICIO', enabled: false, type: 'normal' },
            { label: 'Abrir Panel de Control', click: () => this.openDashboard() },
            { type: 'separator' },
            { label: 'Configuración', click: () => this.openConfigPanel() },
            { label: 'Carpeta de Instalación', click: () => shell.openPath(__dirname) },
            { type: 'separator' },
            { label: 'Reiniciar Aplicación', click: () => this.confirmRestart('full') },
            { type: 'separator' },
            {
                label: autoStartEnabled ? 'Inicio Automático: ACTIVO' : 'Inicio Automático: INACTIVO',
                enabled: false
            },
            { type: 'separator' },
            { label: 'Cerrar API', click: () => this.confirmQuit() }
        ]);

        tray.setContextMenu(menu);
    }

    openDashboard() {
        if (dashboardWindow && !dashboardWindow.isDestroyed()) {
            dashboardWindow.focus();
            return;
        }
        dashboardWindow = new BrowserWindow({
            width: 1200,
            height: 800,
            title: 'Panel de Control - API Autoservicio',
            icon: iconPath,
            webPreferences: { nodeIntegration: true, contextIsolation: false, enableRemoteModule: true },
            autoHideMenuBar: true,
            resizable: true,
            minimizable: true,
            maximizable: true,
            backgroundColor: '#f5f7fa'
        });
        const dashboardPath = join(__dirname, 'dashboard.html');
        if (fs.existsSync(dashboardPath)) {
            dashboardWindow.loadFile(dashboardPath);
        } else {
            const html = this.generateDashboardHtml();
            dashboardWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        }
        dashboardWindow.on('closed', () => { dashboardWindow = null; });
    }

    generateDashboardHtml() {
        return fs.readFileSync(join(__dirname, 'dashboard.html'), 'utf8');
    }

    openConfigPanel() {
        if (configWindow && !configWindow.isDestroyed()) {
            configWindow.focus();
            return;
        }
        configWindow = new BrowserWindow({
            width: 1000,
            height: 700,
            title: 'Configuración - API Autoservicio',
            icon: iconPath,
            webPreferences: { nodeIntegration: true, contextIsolation: false },
            autoHideMenuBar: true,
            resizable: true,
            minimizable: true,
            maximizable: true,
            backgroundColor: '#ffffff'
        });
        const configPath = join(__dirname, 'config-panel.html');
        if (fs.existsSync(configPath)) {
            configWindow.loadFile(configPath);
        } else {
            configWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(this.getConfigHTML())}`);
        }
        configWindow.on('closed', () => { configWindow = null; });
    }

    getConfigHTML() {
        try {
            return fs.readFileSync(join(__dirname, 'config-panel.html'), 'utf8');
        } catch (error) {
            return '<html><body>Error cargando configuración</body></html>';
        }
    }

    showWelcomeNotification() {
        try {
            tray.displayBalloon({
                title: 'API Autoservicio Iniciada',
                content: `Puerto ${PORT} activo - Click derecho para opciones`,
                iconType: 'info'
            });
            setTimeout(() => {
                try { tray.displayBalloon({ title: '', content: '', iconType: 'none' }); } catch (e) { }
            }, 5000);
        } catch (error) {
            console.log('No se pudo mostrar notificación:', error.message);
        }
    }

    openSimpleLogs() {
        const choice = dialog.showMessageBoxSync(null, {
            type: 'question',
            buttons: ['Ver en Notepad', 'Ver en Consola', 'Cancelar'],
            defaultId: 0,
            title: 'Ver Logs',
            message: '¿Cómo deseas ver los logs?',
            detail: `Total de logs capturados: ${logBuffer.length}`
        });
        switch (choice) {
            case 0: this.showRealLogsInNotepad(); break;
            case 1: this.showLogsInNewConsole(); break;
        }
    }

    showRealLogsInNotepad() {
        try {
            const tempLogFile = join(os.tmpdir(), `api-autoservicio-logs-${Date.now()}.txt`);
            fs.writeFileSync(tempLogFile, this.getRealCurrentLogs(), 'utf8');
            shell.openPath(tempLogFile);
        } catch (error) {
            dialog.showMessageBoxSync(null, {
                type: 'error',
                title: 'Error',
                message: 'No se pudieron mostrar los logs',
                detail: `Error: ${error.message}`
            });
        }
    }

    showLogsInNewConsole() {
        try {
            const logFile = join(os.tmpdir(), `api-logs-${Date.now()}.txt`);
            fs.writeFileSync(logFile, this.getRealCurrentLogs(), 'utf8');
            const psCmd = `start powershell -Command "& {Clear-Host; Write-Host 'API AUTOSERVICIO - LOGS' -ForegroundColor Cyan; Write-Host '==========================================' -ForegroundColor Cyan; Get-Content '${logFile}' | ForEach-Object { if ($_ -match 'ERROR') { Write-Host $_ -ForegroundColor Red } elseif ($_ -match 'WARN') { Write-Host $_ -ForegroundColor Yellow } else { Write-Host $_ -ForegroundColor White } }; Write-Host ''; Write-Host 'Presiona cualquier tecla para cerrar...' -ForegroundColor Green; Read-Host}"`;
            exec(psCmd);
        } catch (error) {
            dialog.showMessageBoxSync(null, {
                type: 'error',
                title: 'Error',
                message: 'No se pudo abrir consola con logs'
            });
        }
    }

    getRealCurrentLogs() {
        const now = new Date().toLocaleString('es-CL');
        let logsText = `API AUTOSERVICIO - LOGS\nFecha: ${now}\nPuerto: ${PORT}\nTotal: ${logBuffer.length}\n\n`;
        logBuffer.forEach(log => { logsText += log + '\n'; });
        return logsText;
    }

    confirmRestart(type) {
        const choice = dialog.showMessageBoxSync(null, {
            type: 'question',
            buttons: ['Sí, reiniciar', 'Cancelar'],
            defaultId: 0,
            title: 'Reiniciar Aplicación',
            message: '¿Deseas reiniciar la aplicación?',
            detail: 'Se cerrará y volverá a abrir automáticamente.'
        });
        if (choice === 0) {
            tray.displayBalloon({ title: 'Reiniciando', content: 'Aplicación reiniciándose...', iconType: 'info' });
            app.relaunch();
            app.exit();
        }
    }

    confirmQuit() {
        const choice = dialog.showMessageBoxSync(null, {
            type: 'warning',
            buttons: ['Cerrar API', 'Cancelar'],
            defaultId: 1,
            title: 'Cerrar API',
            message: '¿Estás seguro que deseas cerrar la API?'
        });
        if (choice === 0) {
            isQuitting = true;
            app.quit();
        }
    }
}

const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (tray) {
            tray.displayBalloon({
                title: 'Ya en ejecución',
                content: 'API Autoservicio ya está activa',
                iconType: 'warning'
            });
        }
    });
    new APISystemTray();
}