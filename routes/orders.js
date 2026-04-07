import express from 'express';
import {
    getOrdersForDisplay,
    updateOrderStatus,
    saveTransactionWithOrder,
    getDeliveredOrders,
    getOrderWhatsapp, // 📱 NUEVO
    db
} from '../database.js';
import { log } from '../services/logger.js';
import { sendWhatsAppNotification } from '../services/whatsapp-notifier.js'; // 📱 NUEVO

const router = express.Router();

router.get('/display', async (req, res) => {
    try {
        const { type = 'all' } = req.query;

        log.info(`Solicitud de órdenes para display (tipo: ${type})`);

        const orders = await getOrdersForDisplay();

        let filteredOrders = orders;

        if (type === 'customer') {
            filteredOrders = orders.filter(order =>
                ['en_preparacion', 'listo'].includes(order.order_status)
            );
        } else if (type === 'employee') {
            filteredOrders = orders.filter(order =>
                ['pendiente', 'en_preparacion', 'listo'].includes(order.order_status)
            );
        }

        const groupedOrders = {
            pendiente: filteredOrders.filter(order => order.order_status === 'pendiente'),
            en_preparacion: filteredOrders.filter(order => order.order_status === 'en_preparacion'),
            listo: filteredOrders.filter(order => order.order_status === 'listo')
        };

        const stats = {
            total: filteredOrders.length,
            pendiente: groupedOrders.pendiente.length,
            en_preparacion: groupedOrders.en_preparacion.length,
            listo: groupedOrders.listo.length
        };

        res.json({
            success: true,
            type: type,
            stats: stats,
            orders: groupedOrders,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        log.error('Error obteniendo órdenes para display:', error.message);
        res.status(500).json({
            success: false,
            error: 'Error obteniendo órdenes',
            message: error.message
        });
    }
});

// 📱 MODIFICADO: Ahora envía notificaciones WhatsApp
router.post('/update-status', async (req, res) => {
    try {
        const { transaction_id, new_status } = req.body;

        if (!transaction_id || !new_status) {
            return res.status(400).json({
                success: false,
                error: 'Parámetros requeridos: transaction_id y new_status'
            });
        }

        log.info(`Actualizando orden ID ${transaction_id} a estado: ${new_status}`);

        const validStatuses = ['pendiente', 'en_preparacion', 'listo', 'entregado'];
        if (!validStatuses.includes(new_status)) {
            return res.status(400).json({
                success: false,
                error: `Estado inválido. Debe ser uno de: ${validStatuses.join(', ')}`
            });
        }

        // 📱 NUEVO: Obtener WhatsApp antes de actualizar
        const orderData = await getOrderWhatsapp(transaction_id);

        const changes = await updateOrderStatus(transaction_id, new_status);

        if (changes > 0) {
            log.success(`Orden ID ${transaction_id} actualizada a: ${new_status}`);

            // 📱 NUEVO: Enviar notificación WhatsApp si tiene número
            if (orderData && orderData.whatsapp_number) {
                log.info(`📱 Orden tiene WhatsApp registrado: ${orderData.whatsapp_number}`);

                // Enviar notificación de forma asíncrona (no bloqueante)
                sendWhatsAppNotification(
                    orderData.whatsapp_number,
                    orderData.order_number,
                    new_status
                ).then(sent => {
                    if (sent) {
                        log.success(`📱 Notificación WhatsApp enviada para orden ${orderData.order_number}`);
                    }
                }).catch(err => {
                    log.warn(`📱 No se pudo enviar notificación WhatsApp: ${err.message}`);
                });
            } else {
                log.info('📱 Orden sin WhatsApp registrado - sin notificación');
            }

            res.json({
                success: true,
                message: `Orden actualizada a ${new_status}`,
                transaction_id: transaction_id,
                new_status: new_status,
                updated_at: new Date().toISOString(),
                whatsapp_notification_sent: !!orderData?.whatsapp_number // 📱 NUEVO
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Orden no encontrada'
            });
        }

    } catch (error) {
        log.error('Error actualizando estado de orden:', error.message);
        res.status(500).json({
            success: false,
            error: 'Error actualizando orden',
            message: error.message
        });
    }
});

router.post('/pos', async (req, res) => {
    try {
        const {
            session_id,
            total_amount,
            payment_method = 'efectivo',
            items = [],
            terminal_name = null
        } = req.body;

        if (!session_id || !total_amount) {
            return res.status(400).json({
                success: false,
                error: 'Parámetros requeridos: session_id y total_amount'
            });
        }

        log.info(`Nueva orden POS - Sesión: ${session_id}, Total: $${total_amount}`);

        const posData = {
            tbk_data: {
                amount: parseFloat(total_amount),
                authorization_code: `POS-${Date.now()}`,
                real_date: new Date().toISOString(),
                account_number: 'N/A',
                ticket: Math.floor(Math.random() * 99999),
                terminal_id: 'POS',
                card_type: payment_method === 'tarjeta' ? 'CR' : 'EF'
            },
            sale_data: {
                total: parseFloat(total_amount),
                tip_amount: 0,
                products: items.map((item, index) => ({
                    id: item.product_id || (1000 + index),
                    name: item.name || `Producto ${index + 1}`,
                    price: parseFloat(item.price || 0),
                    cant: parseInt(item.quantity || 1),
                    customization: item.notes || ''
                }))
            },
            session_data: {
                session_id: parseInt(session_id),
                company_data: {
                    name: 'POS PRESENCIAL',
                    vat: '76.000.000-0'
                },
                payment_methods: [
                    { id: 1, name: payment_method }
                ]
            },
            _source: 'pos',
            _timestamp: new Date().toISOString()
        };

        const orderResult = await saveTransactionWithOrder(
            posData,
            parseInt(session_id),
            'pos',
            terminal_name || `POS-${session_id}`
        );

        log.success(`Orden POS ${orderResult.orderNumber} creada ID: ${orderResult.transactionId}`);

        res.json({
            success: true,
            message: 'Orden POS creada exitosamente',
            transaction_id: orderResult.transactionId,
            order_number: orderResult.orderNumber,
            terminal_letter: orderResult.letter,
            sequence_number: orderResult.sequenceNumber,
            total_amount: total_amount
        });

    } catch (error) {
        log.error('Error creando orden POS:', error.message);
        res.status(500).json({
            success: false,
            error: 'Error creando orden POS',
            message: error.message
        });
    }
});

router.get('/stats', async (req, res) => {
    try {
        const orders = await getOrdersForDisplay();

        const byStatus = {
            pendiente: orders.filter(o => o.order_status === 'pendiente').length,
            en_preparacion: orders.filter(o => o.order_status === 'en_preparacion').length,
            listo: orders.filter(o => o.order_status === 'listo').length
        };

        const bySource = {
            autoservicio: orders.filter(o => o.source === 'autoservicio').length,
            pos: orders.filter(o => o.source === 'pos').length
        };

        const byTerminal = {};
        orders.forEach(order => {
            if (order.terminal_letter) {
                byTerminal[order.terminal_letter] = (byTerminal[order.terminal_letter] || 0) + 1;
            }
        });

        const recent = orders
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 5)
            .map(order => ({
                order_number: order.order_number,
                status: order.order_status,
                source: order.source,
                created_at: order.created_at
            }));

        res.json({
            success: true,
            stats: {
                total_active: orders.length,
                by_status: byStatus,
                by_source: bySource,
                by_terminal: byTerminal,
                recent_orders: recent
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        log.error('Error obteniendo estadísticas:', error.message);
        res.status(500).json({
            success: false,
            error: 'Error obteniendo estadísticas',
            message: error.message
        });
    }
});

router.get('/history', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const type = req.query.type || 'all';

        let historyQuery;
        let queryParams;

        if (type === 'delivered') {
            const delivered = await getDeliveredOrders(limit);
            return res.json({
                success: true,
                history: delivered,
                count: delivered.length,
                limit: limit,
                type: 'delivered',
                timestamp: new Date().toISOString()
            });
        } else {
            historyQuery = `
                SELECT 
                    id,
                    order_number,
                    order_status,
                    terminal_letter,
                    source,
                    session_id,
                    created_at,
                    status_updated_at
                FROM transactions 
                WHERE order_number IS NOT NULL
                ORDER BY status_updated_at DESC, created_at DESC
                LIMIT ?
            `;
            queryParams = [limit];
        }

        const history = await new Promise((resolve, reject) => {
            db.all(historyQuery, queryParams, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows || []);
                }
            });
        });

        res.json({
            success: true,
            history: history,
            count: history.length,
            limit: limit,
            type: type,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        log.error('Error obteniendo historial:', error.message);
        res.status(500).json({
            success: false,
            error: 'Error obteniendo historial',
            message: error.message
        });
    }
});

router.get('/delivered', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const delivered = await getDeliveredOrders(limit);

        const todayQuery = `
            SELECT COUNT(*) as today_delivered
            FROM transactions 
            WHERE order_number IS NOT NULL 
            AND order_status = 'entregado'
            AND date(status_updated_at) = date('now')
        `;

        const todayCount = await new Promise((resolve, reject) => {
            db.get(todayQuery, (err, row) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(row?.today_delivered || 0);
                }
            });
        });

        res.json({
            success: true,
            delivered_orders: delivered,
            count: delivered.length,
            today_delivered: todayCount,
            limit: limit,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        log.error('Error obteniendo órdenes entregadas:', error.message);
        res.status(500).json({
            success: false,
            error: 'Error obteniendo órdenes entregadas',
            message: error.message
        });
    }
});

export default router;