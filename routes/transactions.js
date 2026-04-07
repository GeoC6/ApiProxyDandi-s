import express from 'express';
import { getPendingTransactions } from '../database.js';
import { log } from '../services/logger.js';

const router = express.Router();

router.get('/status', async (req, res) => {
    try {
        const pending = await getPendingTransactions();

        res.json({
            pending_transactions: pending.length,
            transactions: pending.map(t => ({
                id: t.id,
                status: t.status,
                created_at: t.created_at,
                error_message: t.error_message
            }))
        });

    } catch (error) {
        log.error('Error obteniendo status:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;