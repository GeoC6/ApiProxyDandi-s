import express from 'express';
import { log } from '../services/logger.js';

const router = express.Router();

let criticalErrors = [];

export function addCriticalError(error) {
    const criticalError = {
        id: Date.now(),
        message: error.message,
        type: error.type || 'error',
        source: error.source || 'unknown',
        timestamp: new Date().toISOString(),
        transaction_id: error.transaction_id || null
    };

    criticalErrors.unshift(criticalError);

    if (criticalErrors.length > 10) {
        criticalErrors = criticalErrors.slice(0, 10);
    }

    log.error(`[CRITICAL] Error crítico agregado: ${error.message}`);

    return criticalError.id;
}

function cleanOldErrors() {
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    criticalErrors = criticalErrors.filter(error =>
        new Date(error.timestamp).getTime() > fiveMinutesAgo
    );
}

router.get('/', async (req, res) => {
    try {
        cleanOldErrors();

        res.json({
            errors: criticalErrors,
            count: criticalErrors.length,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        log.error('Error obteniendo errores críticos:', error.message);
        res.status(500).json({
            error: 'Error interno del servidor',
            errors: [],
            count: 0
        });
    }
});

router.post('/clear/:id', async (req, res) => {
    try {
        const errorId = parseInt(req.params.id);
        const initialLength = criticalErrors.length;

        criticalErrors = criticalErrors.filter(error => error.id !== errorId);

        const removed = initialLength > criticalErrors.length;

        res.json({
            success: removed,
            message: removed ? 'Error eliminado' : 'Error no encontrado',
            remaining_count: criticalErrors.length
        });

    } catch (error) {
        log.error('Error eliminando error crítico:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

router.post('/clear-all', async (req, res) => {
    try {
        const clearedCount = criticalErrors.length;
        criticalErrors = [];

        res.json({
            success: true,
            message: `${clearedCount} errores eliminados`,
            cleared_count: clearedCount
        });

    } catch (error) {
        log.error('Error limpiando errores críticos:', error.message);
        res.status(500).json({
            success: false,
            message: 'Error interno del servidor'
        });
    }
});

export default router;