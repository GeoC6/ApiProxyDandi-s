import express from 'express';
import axios from 'axios';
import { log } from '../services/logger.js';
import { exec } from 'child_process';

const router = express.Router();

const TBK_URL_BASE = "https://api.transbank.cl/transbank/clientes/api/v1/posi";
const TBK_HEADERS = {
  "Content-Type": "application/json",
  "x-client-id": "0e22ba47d983dfe0f1dd6d762d8d7595"
};
const COMMERCE_CODE = "597053063343";

router.post('/:commerce/:terminal/sale', async (req, res) => {
    try {
        const { commerce, terminal } = req.params;
        const { amount, ticket, callback_url } = req.body;
        const url = `${TBK_URL_BASE}/pago`; 

        const bodyParaTransbank = {
            commerceCode: commerce,
            terminalId: terminal,
            totalPayment: parseInt(amount),
            transactionHostId: ticket.toString(),
            urlNotify: callback_url || "https://www.google.com",
            ticket: ticket.toString()
        };

        log.info(`[TBK POST] URL: ${url} Terminal: ${terminal}`);
        
        const response = await axios.post(url, bodyParaTransbank, { headers: TBK_HEADERS });
        
        log.info(`[TBK POST] Éxito: TraceID ${response.data.traceId}`);
        res.json(response.data);
        
    } catch (error) {
        const status = error.response?.status || 500;
        const data = error.response?.data || { error: error.message };
        log.error(`[TBK POST Error]: ${status} - ${JSON.stringify(data)}`);
        res.status(status).json(data);
    }
});

router.get('/:commerce/:terminal/sale/:traceId', async (req, res) => {
    try {
        const { commerce, terminal, traceId } = req.params; 
        
        const url = `${TBK_URL_BASE}/estado/${commerce}/${traceId}`;

        const response = await axios.get(url, { headers: TBK_HEADERS });
        
        log.info(`[TBK GET] Estado consultado para terminal ${terminal}`);
        res.json(response.data);
        
    } catch (error) {
        if (error.response?.status === 404) {
            return res.status(200).json({ status: "PENDING" });
        }

        const status = error.response?.status || 500;
        log.error(`[TBK GET Error]: ${status} - ${error.message}`);
        res.status(status).json(error.response?.data || {});
    }
});



router.patch('/anular', async (req, res) => {
    const { operationNumber, terminalId } = req.body; 

    if (!operationNumber) {
        return res.status(400).json({ success: false, message: "Falta el UUID (Trace ID)" });
    }
    
    if (!terminalId) {
        return res.status(400).json({ success: false, message: "Falta el Terminal ID" });
    }

    try {
        const url = `${TBK_URL_BASE}/cancelar/${COMMERCE_CODE}/${terminalId}/${operationNumber}`; 

        log.info(`[TBK CANCELAR] Enviando PATCH a: ${url}`);

        const response = await axios.patch(url, {}, { headers: TBK_HEADERS });

        res.json({ 
            success: true, 
            message: "Comando de cancelación enviado al POS.", 
            data: response.data 
        });

    } catch (error) {
        const status = error.response?.status || 500;
        const data = error.response?.data || { error: error.message };
        
        log.error(`[TBK CANCELAR Error ${status}]: ${JSON.stringify(data)}`);
        
        let userMessage = "Error al cancelar en Transbank";
        if (status === 404) userMessage = "La transacción no existe o ya no se puede anular.";
        if (status === 422) userMessage = "La transacción no permite anulación en este estado.";
        if (status === 405) userMessage = "Transbank no permite este método en esta ruta.";

        res.status(status).json({
            success: false,
            message: userMessage,
            details: data
        });
    }
});

export default router;