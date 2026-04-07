import express from 'express';
import axios from 'axios';
import { log } from '../services/logger.js';

const router = express.Router();

const ODOO_URL = process.env.ODOO_URL || 'https://dandis.posgo.cl';

let sessionsCache = new Map();
const SESSION_CACHE_TTL = 60 * 60 * 1000;

const getSimpleErrorMessage = (error) => {
    if (error.code) {
        return `${error.code}${error.syscall ? ' ' + error.syscall : ''}`;
    }
    if (error.message) {
        if (error.message.includes('ENOTFOUND')) return 'ENOTFOUND (sin internet)';
        if (error.message.includes('ECONNREFUSED')) return 'ECONNREFUSED (Odoo no disponible)';
        if (error.message.includes('ECONNRESET')) return 'ECONNRESET (conexión cortada)';
        if (error.message.includes('timeout')) return 'TIMEOUT (sin respuesta)';
        return error.message.split('\n')[0];
    }
    return 'Error desconocido';
};

const validateSessionWithOdoo = async (pin, userId) => {
    try {
        log.info('Validando sesión con Odoo (solo PIN)...');

        const response = await axios.post(`${ODOO_URL}/pos_validate_session`, {
            pin: pin.toString(),
            user_id: userId
        }, {
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'API-Intermedia-Autoservicio/1.0'
            }
        });

        if (response.status !== 200) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        log.success('Sesión validada exitosamente con Odoo');
        return response.data;

    } catch (error) {
        const simpleError = getSimpleErrorMessage(error);
        log.error('Error validando sesión con Odoo:', simpleError);
        throw new Error(`Error validando con Odoo: ${simpleError}`);
    }
};

const getSessionFromCache = (pin) => {
    const cacheKey = pin;
    const cached = sessionsCache.get(cacheKey);

    if (!cached) return null;

    const now = Date.now();
    if (now - cached.timestamp > SESSION_CACHE_TTL) {
        sessionsCache.delete(cacheKey);
        return null;
    }

    log.info('Sesión encontrada en cache local');
    return cached.data;
};

const saveSessionToCache = (pin, sessionData) => {
    const cacheKey = pin;
    sessionsCache.set(cacheKey, {
        data: sessionData,
        timestamp: Date.now()
    });
    log.info('Sesión guardada en cache');
};

const cleanExpiredSessions = () => {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, value] of sessionsCache.entries()) {
        if (now - value.timestamp > SESSION_CACHE_TTL) {
            sessionsCache.delete(key);
            cleaned++;
        }
    }

    if (cleaned > 0) {
        log.info(`${cleaned} sesiones expiradas eliminadas del cache`);
    }
};

router.post('/sessions/validate', async (req, res) => {
    try {
        log.info('Solicitud de validación de sesión recibida');

        const { pin, user_id } = req.body;

        if (!pin) {
            log.error('PIN faltante en validación de sesión');
            return res.status(400).json({
                success: false,
                error: 'Parámetro requerido: pin'
            });
        }

        const pinStr = pin.toString();
        const userId = user_id || null;

        log.info(`Validando sesión para PIN: ${pinStr.replace(/./g, '*')}, user_id: ${userId}`);

        const cachedSession = getSessionFromCache(pinStr);
        if (cachedSession) {
            log.info('Usando sesión desde cache');
            return res.json({
                success: true,
                data: cachedSession,
                source: 'cache',
                message: 'Sesión validada desde cache'
            });
        }

        try {
            const sessionData = await validateSessionWithOdoo(pinStr, userId);

            if (sessionData && sessionData.authenticated === true) {
                saveSessionToCache(pinStr, sessionData);

                log.success('Sesión validada y cacheada exitosamente');
                log.info(`POS encontrado: ${sessionData.config_name} (ID: ${sessionData.config_id})`);

                return res.json({
                    success: true,
                    data: sessionData,
                    source: 'odoo',
                    message: 'Sesión validada exitosamente'
                });
            } else {
                log.warn('Autenticación fallida desde Odoo');
                return res.status(401).json({
                    success: false,
                    error: 'Credenciales inválidas',
                    message: sessionData?.message || 'PIN incorrecto o POS no configurado'
                });
            }

        } catch (odooError) {
            log.error('Error conectando con Odoo para validación');
            return res.status(500).json({
                success: false,
                error: 'Error de conectividad con servidor principal',
                message: odooError.message
            });
        }

    } catch (error) {
        const simpleError = getSimpleErrorMessage(error);
        log.error('Error en validación de sesión:', simpleError);

        res.status(500).json({
            success: false,
            error: 'Error interno en validación de sesión',
            message: simpleError
        });
    }
});

router.post('/sessions/close', async (req, res) => {
    try {
        log.info('Solicitud de cierre de sesión recibida');

        const { session_id, pin, confirm, user_id } = req.body;

        if (!session_id || !pin) {
            return res.status(400).json({
                success: false,
                error: 'Parámetros requeridos: session_id y pin'
            });
        }

        const params = new URLSearchParams();
        params.append('session_id', session_id.toString());
        params.append('pin', pin.toString());
        if (confirm) {
            params.append('confirm', 'true');
        }
        if (user_id) {
            params.append('user_id', user_id.toString());
        }

        try {
            const response = await axios.post(`${ODOO_URL}/pos_close_session`, params, {
                timeout: 30000,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'API-Intermedia-Autoservicio/1.0'
                }
            });

            if (response.status !== 200) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            if (response.data && response.data.success) {
                sessionsCache.clear();
                log.info('Cache de sesiones limpiado tras cierre exitoso');
            }

            log.success('Sesión cerrada exitosamente');
            return res.json({
                success: true,
                data: response.data,
                message: 'Sesión cerrada exitosamente'
            });

        } catch (odooError) {
            const simpleError = getSimpleErrorMessage(odooError);
            log.error('Error cerrando sesión con Odoo:', simpleError);

            return res.status(500).json({
                success: false,
                error: 'Error cerrando sesión',
                message: simpleError
            });
        }

    } catch (error) {
        const simpleError = getSimpleErrorMessage(error);
        log.error('Error en cierre de sesión:', simpleError);

        res.status(500).json({
            success: false,
            error: 'Error interno en cierre de sesión',
            message: simpleError
        });
    }
});

router.get('/sessions/status', (req, res) => {
    cleanExpiredSessions();

    const now = Date.now();
    const sessions = [];

    for (const [key, value] of sessionsCache.entries()) {
        const ageMinutes = Math.floor((now - value.timestamp) / (1000 * 60));
        const remainingMinutes = Math.floor((SESSION_CACHE_TTL - (now - value.timestamp)) / (1000 * 60));

        sessions.push({
            pin_masked: key.replace(/./g, '*'),
            config_id: value.data?.config_id || null,
            config_name: value.data?.config_name || null,
            cached_at: new Date(value.timestamp).toISOString(),
            age_minutes: ageMinutes,
            remaining_minutes: Math.max(0, remainingMinutes),
            session_id: value.data?.session_id || null
        });
    }

    res.json({
        total_cached_sessions: sessionsCache.size,
        ttl_minutes: Math.floor(SESSION_CACHE_TTL / (1000 * 60)),
        sessions: sessions.sort((a, b) => b.age_minutes - a.age_minutes)
    });
});

router.post('/sessions/clear-cache', (req, res) => {
    const beforeCount = sessionsCache.size;
    sessionsCache.clear();

    log.info(`Cache de sesiones limpiado manualmente (${beforeCount} sesiones eliminadas)`);

    res.json({
        success: true,
        message: `Cache limpiado exitosamente`,
        sessions_removed: beforeCount
    });
});

export default router;