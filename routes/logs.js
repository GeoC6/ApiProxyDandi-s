import express from 'express';
import { log } from '../services/logger.js';

const router = express.Router();

router.get('/stream', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Cache-Control'
    });

    res.write('data: {"type": "connected", "message": "Conectado al stream de logs", "timestamp": "' + new Date().toISOString() + '"}\n\n');

    log.addStreamingClient(res);

    req.on('close', () => {
        log.removeStreamingClient(res);
    });

    req.on('aborted', () => {
        log.removeStreamingClient(res);
    });
});

router.get('/history', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const buffer = log.getRealtimeBuffer();

        const logs = buffer.slice(-limit);

        res.json({
            logs,
            total: buffer.length,
            limit,
            stats: log.getStats()
        });
    } catch (error) {
        res.status(500).json({
            error: 'Error obteniendo historial de logs',
            message: error.message
        });
    }
});

router.get('/stats', (req, res) => {
    try {
        const stats = log.getStats();
        res.json(stats);
    } catch (error) {
        res.status(500).json({
            error: 'Error obteniendo estadísticas',
            message: error.message
        });
    }
});

router.post('/test', (req, res) => {
    try {
        const { level = 'info', message = 'Mensaje de prueba' } = req.body;

        log[level](message + ` (prueba desde API)`);

        res.json({
            success: true,
            message: 'Log de prueba enviado',
            level,
            content: message
        });
    } catch (error) {
        res.status(500).json({
            error: 'Error enviando log de prueba',
            message: error.message
        });
    }
});

export default router;