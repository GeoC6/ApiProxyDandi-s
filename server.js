import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import axios from 'axios';
import { initDatabase, db, getSetting, setSetting, getAllSettings } from './database.js';
import { log } from './services/logger.js';
import autoservicioRouter from './routes/autoservicio.js';
import proxyRouter from './routes/proxy.js';
import syncStatusRouter from './routes/sync-status.js';
import { startBackgroundProcessor } from './services/background.js';
import criticalErrorsRouter from './routes/critical-errors.js';
import posSessionsRouter from './routes/pos-sessions.js';
import ordersRouter from './routes/orders.js';
import logsRouter from './routes/logs.js';
import transbankRouter from './routes/transbankc2c.js';
import imagesRouter from './routes/images.js';

const httpsAgent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 30000,
    maxSockets: 50,
    maxFreeSockets: 10,
    timeout: 60000,
    rejectUnauthorized: true
});

const app = express();
const PORT = process.env.PORT || 9000;
const ODOO_URL = process.env.ODOO_URL || 'https://dandis.posgo.cl';

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/static', express.static(path.join(__dirname, 'static')));
app.use('/display', express.static(path.join(__dirname, 'display')));

global.db = db;

app.use((req, res, next) => {
    if (!req.path.includes('/getWeight') &&
        !req.path.includes('/api/logs/stream') &&
        !req.path.includes('/display/') &&
        !req.path.includes('/images/')) {
        log.info(`${req.method} ${req.path}`, req.body ? 'with body' : 'no body');
    }
    next();
});

app.post('/authenticate_user', async (req, res) => {
    try {
        log.info('Proxy: /authenticate_user → Odoo');
        const response = await axios.post(`${ODOO_URL}/authenticate_user`, req.body, {
            timeout: 10000,
            headers: { 'Content-Type': 'application/json' },
            httpsAgent: httpsAgent
        });
        res.json(response.data);
    } catch (error) {
        log.error('Error en proxy /authenticate_user:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/pos_validate_session', async (req, res) => {
    try {
        log.info('Proxy: /pos_validate_session → Odoo');
        const response = await axios.post(`${ODOO_URL}/pos_validate_session`, req.body, {
            timeout: 30000,
            headers: { 'Content-Type': 'application/json' },
            httpsAgent: httpsAgent
        });
        res.json(response.data);
    } catch (error) {
        log.error('Error en proxy /pos_validate_session:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/check_session_exists', async (req, res) => {
    try {
        log.info('Proxy: /check_session_exists → Odoo');
        const response = await axios.post(`${ODOO_URL}/check_session_exists`, req.body, {
            timeout: 10000,
            headers: { 'Content-Type': 'application/json' },
            httpsAgent: httpsAgent
        });
        res.json(response.data);
    } catch (error) {
        log.error('Error en proxy /check_session_exists:', error.message);
        res.status(500).json({ session_exists: false });
    }
});

app.post('/pos_close_session', async (req, res) => {
    try {
        log.info('Proxy: /pos_close_session → Odoo');
        const formData = new URLSearchParams();
        for (const [key, value] of Object.entries(req.body)) {
            formData.append(key, value);
        }
        const response = await axios.post(`${ODOO_URL}/pos_close_session`, formData, {
            timeout: 30000,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            httpsAgent: httpsAgent
        });
        res.json(response.data);
    } catch (error) {
        log.error('Error en proxy /pos_close_session:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/', (req, res) => {
    res.json({
        name: 'API Intermedia Autoservicio',
        version: '1.0.0',
        status: 'running',
        endpoints: [
            'POST /authenticate_user',
            'POST /pos_validate_session',
            'POST /check_session_exists',
            'POST /pos_close_session',
            'POST /api/autoservicio/create-order',
            'POST /api/autoservicio/create-order-im30',
            'GET /api/autoservicio/printers/list',
            'POST /api/sell',
            'POST /api/sell_im30',
            'POST /api/last_sell_im30',
            'POST /api/refund_im30',
            'POST /api/close_day_im30',
            'POST /api/poll_im30',
            'GET /api/orders/display',
            'POST /api/orders/update-status',
            'POST /api/orders/pos',
            'GET /api/orders/stats',
            'GET /api/orders/history',
            'GET /api/orders/delivered',
            'POST /api/pos/sessions/validate',
            'POST /api/pos/sessions/close',
            'GET /api/pos/sessions/status',
            'POST /api/pos/sessions/clear-cache',
            'GET /api/logs/history',
            'GET /api/logs/stream',
            'GET /api/logs/stats',
            'POST /api/logs/test',
            'GET /api/sync-status',
            'GET /api/sync-status/debug',
            'GET /api/critical-errors',
            'POST /api/critical-errors/clear/:id',
            'POST /api/critical-errors/clear-all',
            'GET /images/products/:productId',
            'DELETE /images/cache',
            'GET /images/cache/stats',
            'GET /health',
            'GET /api/status',
            'GET /display/employee',
            'GET /display/customer'
        ]
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.get('/display/employee', (req, res) => {
    res.sendFile(path.join(__dirname, 'display', 'employee.html'));
});

app.get('/display/customer', (req, res) => {
    res.sendFile(path.join(__dirname, 'display', 'customer.html'));
});

app.get('/realtime-logs.html', (req, res) => {
    const realtimeLogsPath = path.join(__dirname, 'realtime-logs.html');
    if (fs.existsSync(realtimeLogsPath)) res.sendFile(realtimeLogsPath);
    else res.status(404).send('Archivo de logs en tiempo real no encontrado');
});

app.get('/api/config', async (req, res) => {
    try {
        const saved = await getAllSettings();
        const config = {
            IM30_PORT: saved.IM30_PORT || process.env.IM30_PORT || 'COM8',
            TBK_URL: saved.TBK_URL || process.env.TBK_URL || 'https://localhost:8001',
            XSIGN_URL: saved.XSIGN_URL || process.env.XSIGN_URL || 'http://localhost:5999',
            KDS_URL: saved.KDS_URL || process.env.KDS_URL || 'http://localhost:9001',
            ODOO_URL: saved.ODOO_URL || process.env.ODOO_URL || 'https://dandis.posgo.cl',
            PRINTER_ENABLED: saved.PRINTER_ENABLED || process.env.PRINTER_ENABLED || 'true',
            PRINTER_TICKET_NAME: saved.PRINTER_TICKET_NAME || process.env.PRINTER_TICKET_NAME || '',
        };
        res.json({ success: true, config });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/config', async (req, res) => {
    try {
        const allowed = ['IM30_PORT', 'TBK_URL', 'XSIGN_URL', 'KDS_URL', 'ODOO_URL', 'PRINTER_ENABLED', 'PRINTER_TICKET_NAME'];
        const entries = Object.entries(req.body).filter(([key]) => allowed.includes(key));
        await Promise.all(entries.map(([key, value]) => setSetting(key, String(value))));
        log.success(`Configuración actualizada: ${entries.map(([k]) => k).join(', ')}`);
        res.json({ success: true, updated: entries.length });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.use('/api/autoservicio', autoservicioRouter);
app.use('/api', proxyRouter);
app.use('/api/sync-status', syncStatusRouter);
app.use('/api/critical-errors', criticalErrorsRouter);
app.use('/api/pos', posSessionsRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/logs', logsRouter);
app.use('/api/tbk', transbankRouter);
app.use('/images', imagesRouter);

app.use((err, req, res, next) => {
    log.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

app.use('*', (req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

async function start() {
    try {
        await initDatabase();
        app.listen(PORT, () => {
            log.success(`API Intermedia iniciada en puerto ${PORT}`);
            log.info(`URL: http://localhost:${PORT}`);
            log.info(`ENV path: ${path.join(__dirname, '.env')}`);
            log.info(`PRINTER_TICKET_NAME: "${process.env.PRINTER_TICKET_NAME || '(no definido)'}"`);
            log.info(`ODOO_URL: "${process.env.ODOO_URL || '(no definido)'}"`);
            log.info(`KDS_URL: "${process.env.KDS_URL || '(no definido)'}"`);
            log.info(`HTTPS Agent keepAlive: ACTIVO`);
            log.info(`═══════════════════════════════════════════════════════════`);
            log.info(`Sistema de notificaciones WhatsApp: ${process.env.N8N_WEBHOOK_URL ? 'ACTIVO' : 'DESACTIVADO'}`);
        });
        startBackgroundProcessor();
    } catch (error) {
        log.error('Error iniciando servidor:', error);
        process.exit(1);
    }
}

start();