import axios from 'axios';
import { log } from './logger.js';

// 📱 Configuración - Cambiar por tu webhook de N8N
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'https://n8n.posgo.cl/webhook/bb190ab7-cfb5-4383-8472-39d339a7e396';

/**
 * Mensajes predefinidos por estado
 */
const MESSAGES = {
    pendiente: (orderNumber) =>
        `✅ *¡Pedido Recibido!*\n\nTu pedido *${orderNumber}* ha sido confirmado.\n\n⏳ Te avisaremos cuando esté en preparación.`,

    en_preparacion: (orderNumber) =>
        `👨‍🍳 *¡En Preparación!*\n\nTu pedido *${orderNumber}* está siendo preparado.\n\n⏱️ Te avisaremos cuando esté listo.`,

    listo: (orderNumber) =>
        `🎉 *¡Tu Pedido Está Listo!*\n\nTu pedido *${orderNumber}* está listo para retirar.\n\n📍 Acércate al counter para recogerlo.\n\n¡Gracias por tu compra! 😊`,

    entregado: (orderNumber) =>
        `✅ *Pedido Entregado*\n\nTu pedido *${orderNumber}* ha sido entregado.\n\n¡Gracias por tu preferencia! 🙏`
};

/**
 * Enviar notificación WhatsApp a través de N8N
 * @param {string} whatsappNumber - Número con formato +56912345678
 * @param {string} orderNumber - Número de orden (ej: A001)
 * @param {string} status - Estado del pedido
 * @returns {Promise<boolean>} - true si se envió correctamente
 */
export async function sendWhatsAppNotification(whatsappNumber, orderNumber, status) {
    // Validar que tengamos los datos necesarios
    if (!whatsappNumber || !orderNumber || !status) {
        log.warn('📱 Notificación WhatsApp omitida - datos incompletos');
        return false;
    }

    // Validar que el estado tenga mensaje configurado
    if (!MESSAGES[status]) {
        log.warn(`📱 No hay mensaje configurado para estado: ${status}`);
        return false;
    }

    try {
        log.info(`📱 Enviando notificación WhatsApp a ${whatsappNumber} para orden ${orderNumber} (${status})`);

        const message = MESSAGES[status](orderNumber);

        // Payload para N8N
        const payload = {
            phone: whatsappNumber,
            message: message,
            orderNumber: orderNumber,
            status: status,
            timestamp: new Date().toISOString()
        };

        // Enviar a N8N webhook
        const response = await axios.post(N8N_WEBHOOK_URL, payload, {
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (response.status === 200) {
            log.success(`📱 Notificación WhatsApp enviada exitosamente a ${whatsappNumber}`);
            return true;
        } else {
            log.warn(`📱 Respuesta inesperada de N8N: ${response.status}`);
            return false;
        }

    } catch (error) {
        // No fallar la operación principal si falla WhatsApp
        const errorMsg = error.response?.data?.message || error.message || 'Error desconocido';
        log.error(`📱 Error enviando notificación WhatsApp: ${errorMsg}`);

        // Log más detallado en desarrollo
        if (process.env.NODE_ENV === 'development') {
            console.error('WhatsApp Error Details:', {
                phone: whatsappNumber,
                order: orderNumber,
                status: status,
                error: errorMsg
            });
        }

        return false;
    }
}

/**
 * Validar formato de número WhatsApp
 * @param {string} phone - Número a validar
 * @returns {boolean}
 */
export function isValidWhatsAppNumber(phone) {
    if (!phone) return false;

    // Debe empezar con +56 y tener 9 dígitos después (formato chileno)
    const regex = /^\+569\d{8}$/;
    return regex.test(phone);
}