import express from 'express';
import axios from 'axios';
import https from 'https';
import { log } from '../services/logger.js';

const router = express.Router();

const TBK_URL = process.env.TBK_URL || 'https://localhost:8001';
const XSIGN_URL = process.env.XSIGN_URL || 'http://localhost:5999';

const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

const cleanHeaders = (headers) => {
    const cleaned = { ...headers };
    delete cleaned.host;
    delete cleaned['content-length'];
    delete cleaned.connection;
    delete cleaned['accept-encoding'];
    return cleaned;
};

const getSimpleErrorMessage = (error) => {
    if (error.code) {
        return `${error.code}${error.syscall ? ' ' + error.syscall : ''}`;
    }
    if (error.message) {
        if (error.message.includes('ENOTFOUND')) return 'ENOTFOUND (sin internet)';
        if (error.message.includes('ECONNREFUSED')) return 'ECONNREFUSED (servicio no disponible)';
        if (error.message.includes('ECONNRESET')) return 'ECONNRESET (conexión cortada)';
        if (error.message.includes('timeout')) return 'TIMEOUT (sin respuesta)';
        return error.message.split('\n')[0];
    }
    return 'Error desconocido';
};

router.post('/sell', async (req, res) => {
    try {
        log.info('Proxy TBK sell (VX520/VX680)');

        const response = await axios.post(`${TBK_URL}/sell`, req.body, {
            timeout: 120000,
            headers: { 'Content-Type': 'application/json' },
            httpsAgent: httpsAgent
        });

        log.success('TBK sell response OK');
        res.status(response.status).json(response.data);

    } catch (error) {
        const simpleError = getSimpleErrorMessage(error);
        log.error('Error proxy TBK sell:', simpleError);

        if (error.response) {
            res.status(error.response.status).json(error.response.data);
        } else {
            res.status(500).json({ error: 'TBK service unavailable' });
        }
    }
});

router.post('/sell_im30', async (req, res) => {
    try {
        log.info('Proxy TBK sell_im30 (IM30 WiFi)');

        const response = await axios.post(`${TBK_URL}/sell_im30`, req.body, {
            timeout: 120000,
            headers: { 'Content-Type': 'application/json' },
            httpsAgent: httpsAgent
        });

        log.success('TBK sell_im30 response OK');
        res.status(response.status).json(response.data);

    } catch (error) {
        const simpleError = getSimpleErrorMessage(error);
        log.error('Error proxy TBK sell_im30:', simpleError);

        if (error.response) {
            res.status(error.response.status).json(error.response.data);
        } else {
            res.status(500).json({ error: 'TBK IM30 service unavailable' });
        }
    }
});

router.post('/last_sell_im30', async (req, res) => {
    try {
        log.info('Proxy TBK last_sell_im30 (IM30 WiFi)');

        const response = await axios.post(`${TBK_URL}/last_sell_im30`, req.body, {
            timeout: 120000,
            headers: { 'Content-Type': 'application/json' },
            httpsAgent: httpsAgent
        });

        log.success('TBK last_sell_im30 response OK');
        res.status(response.status).json(response.data);

    } catch (error) {
        const simpleError = getSimpleErrorMessage(error);
        log.error('Error proxy TBK last_sell_im30:', simpleError);

        if (error.response) {
            res.status(error.response.status).json(error.response.data);
        } else {
            res.status(500).json({ error: 'TBK IM30 service unavailable' });
        }
    }
});

router.post('/refund_im30', async (req, res) => {
    try {
        log.info('Proxy TBK refund_im30 (IM30 WiFi)');

        const response = await axios.post(`${TBK_URL}/refund_im30`, req.body, {
            timeout: 120000,
            headers: { 'Content-Type': 'application/json' },
            httpsAgent: httpsAgent
        });

        log.success('TBK refund_im30 response OK');
        res.status(response.status).json(response.data);

    } catch (error) {
        const simpleError = getSimpleErrorMessage(error);
        log.error('Error proxy TBK refund_im30:', simpleError);

        if (error.response) {
            res.status(error.response.status).json(error.response.data);
        } else {
            res.status(500).json({ error: 'TBK IM30 service unavailable' });
        }
    }
});

router.post('/close_day_im30', async (req, res) => {
    try {
        log.info('Proxy TBK close_day_im30 (IM30 WiFi)');

        const response = await axios.post(`${TBK_URL}/close_day_im30`, req.body, {
            timeout: 120000,
            headers: { 'Content-Type': 'application/json' },
            httpsAgent: httpsAgent
        });

        log.success('TBK close_day_im30 response OK');
        res.status(response.status).json(response.data);

    } catch (error) {
        const simpleError = getSimpleErrorMessage(error);
        log.error('Error proxy TBK close_day_im30:', simpleError);

        if (error.response) {
            res.status(error.response.status).json(error.response.data);
        } else {
            res.status(500).json({ error: 'TBK IM30 service unavailable' });
        }
    }
});

router.post('/poll_im30', async (req, res) => {
    try {
        log.info('Proxy TBK poll_im30 (IM30 WiFi)');

        const response = await axios.post(`${TBK_URL}/poll_im30`, req.body, {
            timeout: 30000,
            headers: { 'Content-Type': 'application/json' },
            httpsAgent: httpsAgent
        });

        log.success('TBK poll_im30 response OK');
        res.status(response.status).json(response.data);

    } catch (error) {
        const simpleError = getSimpleErrorMessage(error);
        log.error('Error proxy TBK poll_im30:', simpleError);

        if (error.response) {
            res.status(error.response.status).json(error.response.data);
        } else {
            res.status(500).json({ error: 'TBK IM30 service unavailable' });
        }
    }
});

export default router;