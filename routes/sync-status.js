import express from 'express';
import { getPendingTransactions } from '../database.js';
import { getProcessorState } from '../services/background.js';
import { log } from '../services/logger.js';

const router = express.Router();

router.get('/', async (req, res) => {
    try {
        const pendingTransactions = await getPendingTransactions();
        const processorState = getProcessorState();
        const pendingCount = pendingTransactions.length;
        const lastSync = await getLastSuccessfulSync();

        const transactionData = pendingTransactions.map(transaction => ({
            id: transaction.id,
            created_at: transaction.created_at,
            folio_dte: transaction.folio_dte || null,
            error_message: transaction.error_message || null,
            age_minutes: Math.floor((Date.now() - new Date(transaction.created_at).getTime()) / (1000 * 60))
        }));

        const allFailedTransactions = await new Promise((resolve) => {
            global.db?.all(`
                SELECT error_message FROM transactions 
                WHERE status = 'failed' 
                AND (
                    error_message LIKE '%No hay Folios Disponibles%' OR
                    error_message LIKE '%no hay folios disponibles%' OR
                    error_message LIKE '%No hay folios%' OR
                    error_message LIKE '%no hay folios%'
                )
                AND processed_at > datetime('now', '-1 hour')
                ORDER BY processed_at DESC
                LIMIT 5
            `, (err, rows) => {
                resolve(rows || []);
            });
        });

        const criticalErrors = allFailedTransactions.map(t => t.error_message);

        const response = {
            pending_count: pendingCount,
            is_processing: processorState.isProcessing,
            current_transaction_id: processorState.currentTransactionId,
            pending_transactions: transactionData,
            last_sync: lastSync,
            last_processing_time: processorState.lastProcessingTime,
            total_processed: processorState.totalProcessed,
            total_errors: processorState.totalErrors,
            critical_errors: criticalErrors,
            has_folio_error: criticalErrors.length > 0,
            status: pendingCount === 0 ? 'synced' : (processorState.isProcessing ? 'syncing' : 'pending'),
            api_status: 'online'
        };

        res.json(response);

    } catch (error) {
        const simpleError = error.message ? error.message.split('\n')[0] : 'Error desconocido';
        log.error('Error obteniendo estado de sincronización:', simpleError);
        res.status(500).json({
            error: 'Error interno del servidor',
            pending_count: 0,
            is_processing: false,
            pending_transactions: [],
            status: 'error',
            api_status: 'error'
        });
    }
});

async function getLastSuccessfulSync() {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT processed_at 
            FROM transactions 
            WHERE status = 'completed' 
            ORDER BY processed_at DESC 
            LIMIT 1
        `;

        global.db?.get(query, (err, row) => {
            if (err) {
                resolve(null);
            } else {
                resolve(row?.processed_at || null);
            }
        });
    });
}

async function isBackgroundProcessing() {
    try {
        const recentActivity = await checkRecentProcessingActivity();
        return recentActivity;
    } catch (error) {
        return false;
    }
}

async function checkRecentProcessingActivity() {
    return new Promise((resolve) => {
        const oneMinuteAgo = new Date(Date.now() - 60000).toISOString();

        const query = `
            SELECT COUNT(*) as recent_count
            FROM transactions 
            WHERE (status = 'completed' OR status = 'failed')
            AND processed_at > ?
        `;

        global.db?.get(query, [oneMinuteAgo], (err, row) => {
            if (err) {
                resolve(false);
            } else {
                resolve((row?.recent_count || 0) > 0);
            }
        });
    });
}

router.get('/debug', async (req, res) => {
    try {
        const query = `
            SELECT id, status, error_message, folio_dte, created_at, processed_at
            FROM transactions 
            ORDER BY id DESC 
            LIMIT 20
        `;

        const transactions = await new Promise((resolve, reject) => {
            global.db?.all(query, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });

        res.json({
            transactions,
            total_count: transactions.length,
            by_status: {
                pending: transactions.filter(t => t.status === 'pending').length,
                completed: transactions.filter(t => t.status === 'completed').length,
                failed: transactions.filter(t => t.status === 'failed').length,
            }
        });

    } catch (error) {
        res.status(500).json({
            error: 'Error consultando transacciones',
            message: error.message
        });
    }
});

export default router;