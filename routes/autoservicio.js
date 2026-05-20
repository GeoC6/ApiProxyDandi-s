import express from 'express';
import { saveTransactionWithOrder, getNextInternalVoucherNumber, getSetting } from '../database.js';
import { log } from '../services/logger.js';
import printerService from '../services/printerService.js';
import axios from 'axios';
import https from 'https';

const router = express.Router();

const getXSignUrl = () => getSetting('XSIGN_URL', process.env.XSIGN_URL || 'http://localhost:5999');
const getTbkUrl = () => getSetting('TBK_URL', process.env.TBK_URL || 'https://localhost:8001');
const getKdsUrl = () => getSetting('KDS_URL', process.env.KDS_URL || 'http://localhost:9001');
const getIm30Port = () => getSetting('IM30_PORT', process.env.IM30_PORT || 'COM8');

const httpsAgent = new https.Agent({
    rejectUnauthorized: false
});

const INTERNAL_VOUCHER_METHODS = {
    7: 'E',
    8: 'P',
    9: 'A'
};

function isInternalVoucher(paymentIds) {
    if (!paymentIds || paymentIds.length === 0) return false;
    return paymentIds.every(id => INTERNAL_VOUCHER_METHODS.hasOwnProperty(id));
}

function getVoucherPrefix(paymentIds) {
    const firstValidId = paymentIds.find(id => INTERNAL_VOUCHER_METHODS.hasOwnProperty(id));
    return INTERNAL_VOUCHER_METHODS[firstValidId] || 'V';
}

async function sendToKDS(orderData, orderNumber, transactionId, source = 'autoservicio') {
    const KDS_URL = await getKdsUrl();
    if (!KDS_URL) {
        log.info('KDS_URL no configurada, omitiendo envío a KDS centralizada');
        return;
    }

    try {
        const kdsPayload = {
            external_id: transactionId?.toString() || Date.now().toString(),
            order_number: orderNumber,
            note: orderData.sale_data?.note || '',
            items: orderData.sale_data?.products?.map(p => ({
                name: p.name,
                cant: p.cant,
                notes: p.customization || '',
                attribute_lines: p.attribute_lines || []
            })) || [],
            source: source,
            customer_name: 'Cliente'
        };

        log.info(` Enviando orden al KDS centralizado: ${KDS_URL}`);

        const response = await axios.post(`${KDS_URL}/api/kds/new-order`, kdsPayload, {
            timeout: 5000,
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.data?.success) {
            log.success(` Orden enviada a KDS centralizada (ID: ${response.data.kds_id})`);
        } else {
            log.warn(' KDS respondió pero sin confirmar éxito');
        }
    } catch (error) {
        log.error(' Error enviando a KDS centralizada:', error.message);
    }
}

function buildDTEData(transactionData) {
    const { tbk_data, sale_data, session_data } = transactionData;

    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║      DATOS DE EMPRESA PARA DTE (buildDTEData)           ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log('session_data.company_data:', JSON.stringify(session_data.company_data, null, 2));
    console.log('');
    console.log('Emisor que se construirá para XSign:');
    console.log('  - RUTEmisor:', session_data.company_data?.vat || '77283971-5');
    console.log('  - RznSoc:', session_data.company_data?.name || 'AUTOSERVICIO');
    console.log('  - GiroEmis:', session_data.company_data?.turn || 'COMERCIO');
    console.log('  - Acteco:', session_data.company_data?.acteco || '471100');
    console.log('  - DirOrigen:', session_data.company_data?.street || 'N/A');
    console.log('  - CmnaOrigen:', session_data.company_data?.city || 'N/A');
    console.log('═══════════════════════════════════════════════════════════');

    const dteData = {
        Encabezado: {
            IdDoc: {
                TipoDTE: 39,
                FchEmis: new Date().toISOString().split('T')[0]
            },
            Emisor: {
                RUTEmisor: session_data.company_data?.vat || '77283971-5',
                RznSoc: session_data.company_data?.name || 'AUTOSERVICIO',
                GiroEmis: session_data.company_data?.turn || 'COMERCIO',
                Acteco: session_data.company_data?.acteco || '471100',
                DirOrigen: session_data.company_data?.street || 'N/A',
                CmnaOrigen: session_data.company_data?.city || 'N/A',
                CdgVendedor: "autoservicio"
            },
            Receptor: {
                RUTRecep: "66666666-6",
                RznSocRecep: "CLIENTE AUTOSERVICIO",
                DirRecep: "N/A",
                CmnaRecep: "N/A"
            },
            Totales: {
                MntNeto: Math.round(sale_data.total / 1.19),
                IVA: Math.round(sale_data.total - sale_data.total / 1.19),
                MntTotal: Math.round(sale_data.total + (sale_data.tip_amount || 0))
            }
        },
        infoPagos: {
            Propina: parseFloat(sale_data.tip_amount || 0),
            CdgVendedor: "autoservicio",
            AjusteSencillo: 0,
            Vuelto: 0,
            Pagos: [{
                desc: tbk_data.card_type === "DB" ? "DEBITO" : "CREDITO",
                monto: Math.round(tbk_data.amount)
            }]
        },
        Detalle: [],
        DscRcgGlobal: [],
        session_id: session_data.session_id || 0
    };

    let lineNumber = 1;

    if (sale_data.products && sale_data.products.length > 0) {
        sale_data.products.forEach(product => {
            if (product.cant > 0) {
                let productName = product.name || `Producto ${product.id}`;
                let descripcion = product.customization || "";

                if (Array.isArray(product.attribute_lines) && product.attribute_lines.length > 0) {
                    const extrasShort = [];
                    const extrasFull = [];

                    product.attribute_lines.forEach(attr => {
                        const category = attr.attribute_name || attr.category_name || '';
                        const ingredient = attr.name || '';
                        const qty = attr.qty > 1 ? ` x${attr.qty}` : '';

                        if (ingredient) {
                            extrasShort.push(ingredient + qty);
                        }

                        if (category && ingredient) {
                            extrasFull.push(`[${category}] ${ingredient}${qty}`);
                        } else if (ingredient) {
                            extrasFull.push(`${ingredient}${qty}`);
                        }
                    });

                    if (extrasShort.length > 0) {
                        productName = `${productName} (${extrasShort.join(', ')})`;
                    }

                    if (extrasFull.length > 0) {
                        descripcion = extrasFull.join(', ');
                    }
                }

                if (!descripcion || descripcion === "N/A") {
                    descripcion = "Producto personalizado";
                }

                dteData.Detalle.push({
                    NroLinDet: lineNumber++,
                    CdgItem: {
                        TpoCodigo: "INT1",
                        VlrCodigo: product.id.toString()
                    },
                    NmbItem: productName.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '').substring(0, 70),
                    DscItem: descripcion.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E]/g, '').substring(0, 1000),
                    QtyItem: product.cant,
                    PrcItem: Math.round(product.price),
                    MontoItem: Math.round(product.price * product.cant)
                });
            }
        });
    }

    if (dteData.Detalle.length === 0) {
        dteData.Detalle.push({
            NroLinDet: 1,
            CdgItem: {
                TpoCodigo: "INT1",
                VlrCodigo: "999999"
            },
            NmbItem: "Venta Autoservicio",
            DscItem: "Venta realizada en sistema autoservicio",
            QtyItem: 1,
            PrcItem: Math.round(sale_data.total),
            MontoItem: Math.round(sale_data.total)
        });
    }

    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║      DTE COMPLETO QUE SE ENVIARÁ A XSIGN                 ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log(JSON.stringify(dteData, null, 2));
    console.log('═══════════════════════════════════════════════════════════');

    return dteData;
}

async function generateDTE(transactionData) {
    log.info('Generando DTE...');

    const dteData = buildDTEData(transactionData);

    let baseUrl = await getXSignUrl();
    if (!baseUrl.includes('/sign/39')) {
        baseUrl = `${baseUrl}/sign/39`;
    }
    const finalUrl = `${baseUrl}?getTED=false&sendDTE=true`;

    try {
        log.info(`Llamando a XSign: ${finalUrl}`);

        const response = await axios.post(finalUrl, dteData, {
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
                'withCredentials': 'true',
                'Access-Control-Allow-Origin': '*',
                'Accept': '*/*',
                'cache-control': 'no-cache'
            },
            httpsAgent: httpsAgent
        });

        if (response.status !== 200) {
            throw new Error(`Error generando DTE: ${response.status}`);
        }

        log.success(`DTE generado exitosamente - Folio: ${response.data.folio}`);

        return {
            ...response.data,
            originalDTE: dteData
        };

    } catch (error) {
        if (error.response && error.response.status === 400) {
            const errorData = error.response.data;
            const errorMessage = errorData?.message || 'Error 400 desde XSign';
            log.error(`XSign Error 400: ${errorMessage}`);
            throw new Error(`XSign Error 400: ${errorMessage}`);
        }
        throw error;
    }
}

router.post('/create-order', async (req, res) => {
    try {
        log.info('Nueva orden de autoservicio recibida');
        log.info('RAW products recibidos:');
        (req.body.orders?.[0]?.products || []).forEach(p => {
            log.info(`  ${p.name}: attribute_lines = ${JSON.stringify(p.attribute_lines || [])}`);
        });

        if (!req.body.orders || !req.body.orders[0] || !req.body.orders[0].products || req.body.orders[0].products.length === 0) {
            log.warn('Orden recibida sin productos. Ignorando para evitar duplicados.');
            return res.json({ success: false, message: 'Orden vacía ignorada' });
        }

        const adaptedData = adaptAutoservicioToInternal(req.body);

        const sessionId = parseInt(req.body.session_id);
        if (!sessionId) {
            throw new Error('session_id es requerido');
        }

        const whatsappNumber = req.body.whatsapp_number || null;

        if (whatsappNumber) {
            log.info(` WhatsApp: ${whatsappNumber}`);
        }

        const order = req.body.orders[0];
        const paymentIds = order.payment.map(p => parseInt(p.id));
        const isVoucher = isInternalVoucher(paymentIds);

        let dteResponse = null;
        let voucherNumber = null;

        if (isVoucher) {
            log.info('═══════════════════════════════════════════════════════════');
            log.info(' VALE INTERNO DETECTADO - NO SE GENERARÁ DTE');
            log.info('═══════════════════════════════════════════════════════════');
            log.info(`  Métodos de pago: ${paymentIds.join(', ')}`);
            log.info(`  Sesión: ${sessionId}`);

            const prefix = getVoucherPrefix(paymentIds);
            voucherNumber = await getNextInternalVoucherNumber(prefix, sessionId);

            log.info(`  Número de vale generado: ${voucherNumber}`);
            log.info('═══════════════════════════════════════════════════════════');
        } else {
            try {
                dteResponse = await generateDTE(adaptedData);
                log.info(` DTE generado con folio: ${dteResponse.folio}`);
            } catch (dteError) {
                log.error(' Error generando DTE:', dteError.message);
                throw new Error(`No se pudo generar el DTE: ${dteError.message}`);
            }
        }

        const orderResult = await saveTransactionWithOrder(
            adaptedData,
            sessionId,
            'autoservicio',
            `Terminal-${sessionId}`,
            whatsappNumber,
            dteResponse,
            isVoucher,
            voucherNumber
        );

        if (isVoucher) {
            log.success(`Vale interno ${voucherNumber} guardado como orden ${orderResult.orderNumber}`);
        } else {
            log.success(`Orden ${orderResult.orderNumber} guardada con folio ${dteResponse.folio}`);
        }

        printerService.printOrderTicket(orderResult.orderNumber, adaptedData)
            .catch(err => log.error('Error imprimiendo ticket de orden:', err.message));

        sendToKDS(adaptedData, orderResult.orderNumber, orderResult.transactionId, 'autoservicio')
            .catch(err => log.error('Error enviando a KDS:', err.message));

        res.json({
            success: true,
            transaction_id: orderResult.transactionId,
            order_number: orderResult.orderNumber,
            terminal_letter: orderResult.letter,
            sequence_number: orderResult.sequenceNumber,
            dte_folio: isVoucher ? voucherNumber : (dteResponse?.folio || 0),
            is_internal_voucher: isVoucher,
            internal_voucher_number: isVoucher ? voucherNumber : '',
            message: isVoucher ? 'Vale interno procesado correctamente' : 'Orden procesada correctamente'
        });

    } catch (error) {
        log.error('Error procesando orden:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.post('/create-order-im30', async (req, res) => {
    try {
        log.info('═══════════════════════════════════════════════════════════');
        log.info('Nueva orden IM30 recibida');
        log.info('═══════════════════════════════════════════════════════════');

        const { session_id, amount, ticket, products, whatsapp_number, company_data, tip_amount, note } = req.body;

        if (!session_id) {
            throw new Error('session_id es requerido');
        }

        if (!amount || amount <= 0) {
            throw new Error('amount es requerido y debe ser mayor a 0');
        }

        const sessionId = parseInt(session_id);
        const whatsapp = whatsapp_number || null;

        if (whatsapp) {
            log.info(` WhatsApp: ${whatsapp}`);
        }

        log.info('PASO 1: Llamando a Transbank IM30...');

        const [tbkUrl, im30Port] = await Promise.all([getTbkUrl(), getIm30Port()]);
        const tbkResponse = await axios.post(`${tbkUrl}/sell_im30`, {
            amount: parseInt(amount),
            ticket: ticket || Math.floor(Math.random() * 99999),
            printer: false,
            port: im30Port
        }, {
            timeout: 120000,
            headers: { 'Content-Type': 'application/json' },
            httpsAgent: httpsAgent
        });

        // GoTBK /sell_im30 devuelve { trace_id, trace_trama, data: { ...transaccion } }
        const tbkData = tbkResponse.data?.data || tbkResponse.data;

        if (!tbkData || tbkData.codigo_respuesta !== 'Aprobado') {
            throw new Error(`Transbank rechazó la transacción: ${tbkData?.codigo_respuesta || 'Error desconocido'}`);
        }

        log.success(` Transbank aprobado - Auth: ${tbkData.authorization_code}`);
        log.info(`   Terminal: ${tbkData.terminal_id}`);
        log.info(`   Monto: $${tbkData.amount}`);
        log.info(`   Tarjeta: **** ${tbkData.ultimos_4_digitos}`);

        log.info('PASO 2: Adaptando datos IM30...');
        const adaptedData = adaptIM30ToInternal(req.body, tbkData);

        log.info('PASO 3: Generando DTE...');
        let dteResponse;
        try {
            dteResponse = await generateDTE(adaptedData);
            log.success(` DTE generado con folio: ${dteResponse.folio}`);
        } catch (dteError) {
            log.error(' Error generando DTE:', dteError.message);
            throw new Error(`No se pudo generar el DTE: ${dteError.message}`);
        }

        log.info('PASO 4: Guardando en base de datos...');
        const orderResult = await saveTransactionWithOrder(
            adaptedData,
            sessionId,
            'autoservicio-im30',
            `IM30-${sessionId}`,
            whatsapp,
            dteResponse,
            false,
            null
        );

        log.success('═══════════════════════════════════════════════════════════');
        log.success(` ORDEN COMPLETADA: ${orderResult.orderNumber}`);
        log.success(`   - Transaction ID: ${orderResult.transactionId}`);
        log.success(`   - Folio DTE: ${dteResponse.folio}`);
        log.success(`   - Auth TBK: ${tbkData.authorization_code}`);
        log.success(`   - Terminal: ${tbkData.terminal_id}`);
        if (whatsapp) {
            log.success(`   - WhatsApp: ${whatsapp}`);
        }
        log.success('═══════════════════════════════════════════════════════════');

        printerService.printOrderTicket(orderResult.orderNumber, adaptedData)
            .catch(err => log.error('Error imprimiendo ticket de orden:', err.message));

        sendToKDS(adaptedData, orderResult.orderNumber, orderResult.transactionId, 'autoservicio-im30')
            .catch(err => log.error('Error enviando a KDS:', err.message));

        res.json({
            success: true,
            transaction_id: orderResult.transactionId,
            order_number: orderResult.orderNumber,
            terminal_letter: orderResult.letter,
            sequence_number: orderResult.sequenceNumber,
            dte_folio: dteResponse.folio,
            tbk_data: tbkResponse.data,
            message: 'Orden IM30 procesada correctamente'
        });

    } catch (error) {
        log.error('═══════════════════════════════════════════════════════════');
        log.error(' ERROR PROCESANDO ORDEN IM30');
        log.error(`   ${error.message}`);
        log.error('═══════════════════════════════════════════════════════════');

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

router.post('/test-print-order', async (req, res) => {
    const orderNumber = req.body.order_number || 'K99';
    await printerService.printOrderNumber(orderNumber);
    res.json({ success: true, order_number: orderNumber });
});

router.get('/printers/list', async (req, res) => {
    try {
        const printers = await printerService.listAvailablePrinters();
        res.json({
            success: true,
            count: printers.length,
            printers: printers.map(p => ({
                name: p.name,
                available: p.available
            }))
        });
    } catch (error) {
        log.error('Error en endpoint /printers/list:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

function adaptAutoservicioToInternal(frontendData) {
    const { session_id, orders, company_data } = frontendData;

    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║      COMPANY_DATA RECIBIDO EN LA API                    ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log('company_data recibido del frontend:', JSON.stringify(company_data, null, 2));
    console.log('═══════════════════════════════════════════════════════════');

    if (!orders || orders.length === 0) {
        throw new Error('No se encontraron órdenes');
    }

    const order = orders[0];
    const { products, payment, data_card, tip_amount, note } = order;

    if (!payment || payment.length === 0) {
        throw new Error('No se encontró información de pago');
    }

    const session_data = {
        session_id: parseInt(session_id),
        company_data: company_data || {
            name: 'AUTOSERVICIO',
            vat: '77283971-5',
            street: 'N/A',
            city: 'N/A',
            turn: 'COMERCIO',
            acteco: '471100'
        },
        payment_methods: payment.map(p => ({ id: p.id, monto: p.monto }))
    };

    const cardData = data_card || {};

    const totalPayments = payment.reduce((sum, p) => sum + parseFloat(p.monto), 0);

    const tbk_data = {
        amount: parseFloat(cardData.res_amount || totalPayments),
        authorization_code: cardData.res_authorization_code || '',
        voucher_num: cardData.res_voucher_num || cardData.res_authorization_code || '',
        owner_id: cardData.res_owner_id_num || '0',
        real_date: cardData.res_real_date || new Date().toISOString(),
        account_number: cardData.res_account_number || '',
        ticket: cardData.res_ticket || '',
        terminal_id: cardData.res_terminal_id || 'POS-WIFI',
        card_type: cardData.res_card_type || 'DB',
        num_operacion: cardData.res_ticket || '',
        ultimos_4_digitos: cardData.res_account_number || '',
        abrev_tarjeta: cardData.res_card_type || 'DB',
        codigo_comercio: session_data?.company_data?.vat || '',
        hora_transaccion: new Date().toLocaleTimeString('es-CL'),
        num_cuotas: parseInt(cardData.res_installments || 0),
        monto_cuota: 0,
        fecha_contable: new Date().toISOString().split('T')[0]
    };

    const sale_data = {
        total: totalPayments,
        tip_amount: parseFloat(tip_amount || 0),
        note: note || "",
        products: [],
        payments: payment
    };

    if (products && products.length > 0) {
        products.forEach(product => {
            const productData = {
                id: parseInt(product.product_id),
                name: product.name || product.product_name || `Producto ID: ${product.product_id}`,
                price: parseFloat(product.price_subtotal / product.qty),
                cant: parseInt(product.qty),
                customization: product.customization || '',
                selected_attributes: product.selected_attributes || null
            };

            if (product.attribute_lines) {
                productData.attribute_lines = product.attribute_lines;
            }

            sale_data.products.push(productData);
        });
    }

    console.log('╔═══════════════════════════════════════════════════════════╗');
    console.log('║      COMPANY_DATA QUE SE USARÁ EN session_data          ║');
    console.log('╚═══════════════════════════════════════════════════════════╝');
    console.log('session_data.company_data:', JSON.stringify(session_data.company_data, null, 2));
    console.log('═══════════════════════════════════════════════════════════');

    log.info('Datos adaptados:');
    log.info(`  Empresa: ${session_data.company_data.name} (${session_data.company_data.vat})`);
    log.info(`  Dirección: ${session_data.company_data.street}, ${session_data.company_data.city}`);
    log.info(`  Giro: ${session_data.company_data.turn}`);
    log.info(`  Acteco: ${session_data.company_data.acteco}`);
    log.info(`  TBK: ${tbk_data.authorization_code} - $${tbk_data.amount}`);
    log.info(`  Productos: ${sale_data.products.length}`);

    return {
        tbk_data,
        sale_data,
        session_data,
        _source: 'autoservicio',
        _timestamp: new Date().toISOString()
    };
}

function adaptIM30ToInternal(frontendData, tbkData) {
    const { session_id, products = [], company_data, tip_amount = 0, note = '' } = frontendData;

    log.info('Adaptando datos IM30 a estructura interna...');

    const tbk_data = {
        amount: parseFloat(tbkData.amount || 0),
        authorization_code: tbkData.authorization_code || '',
        real_date: tbkData.real_date || new Date().toISOString().split('T')[0].replace(/-/g, ''),
        account_number: tbkData.account_number || tbkData.ultimos_4_digitos || '',
        ticket: tbkData.ticket || '',
        terminal_id: tbkData.terminal_id || 'IM30',
        card_type: tbkData.card_type || 'DB',
        num_operacion: tbkData.num_operacion || '',
        ultimos_4_digitos: tbkData.ultimos_4_digitos || '',
        abrev_tarjeta: tbkData.abrev_tarjeta || '',
        codigo_comercio: tbkData.codigo_comercio || '',
        hora_transaccion: tbkData.hora_transaccion || '',
        num_cuotas: tbkData.num_cuotas || 0,
        monto_cuota: tbkData.monto_cuota || 0,
        fecha_contable: tbkData.fecha_contable || ''
    };

    let calculatedTotal = 0;
    if (products && products.length > 0) {
        calculatedTotal = products.reduce((sum, p) => {
            const price = parseFloat(p.price || 0);
            const qty = parseInt(p.qty || p.cant || 0);
            let productTotal = price * qty;

            if (p.attribute_lines && p.attribute_lines.length > 0) {
                p.attribute_lines.forEach(attrLine => {
                    if (attrLine.is_addition) {
                        const attrPrice = parseFloat(attrLine.price || 0);
                        const attrQty = parseInt(attrLine.qty || 0);
                        productTotal += (attrPrice * attrQty);
                    }
                });
            }

            return sum + productTotal;
        }, 0);
    } else {
        calculatedTotal = parseFloat(tbkData.amount || 0);
    }

    const sale_data = {
        total: calculatedTotal,
        tip_amount: parseFloat(tip_amount || 0),
        note: note || '',
        products: [],
        payments: [{
            id: 2,
            monto: calculatedTotal,
            externalData: tbkData
        }]
    };

    if (products && products.length > 0) {
        products.forEach(product => {
            const productData = {
                id: parseInt(product.product_id || product.id || 999),
                name: product.name || product.product_name || 'Producto',
                price: parseFloat(product.price || 0),
                cant: parseInt(product.qty || product.cant || 1),
                customization: product.customization || '',
                selected_attributes: product.selected_attributes || null
            };

            if (product.attribute_lines) {
                productData.attribute_lines = product.attribute_lines;
            }

            sale_data.products.push(productData);
        });
    } else {
        sale_data.products.push({
            id: 999999,
            name: 'Venta IM30',
            price: calculatedTotal,
            cant: 1,
            customization: 'Venta realizada en terminal IM30'
        });
    }

    const session_data = {
        session_id: parseInt(session_id),
        company_data: company_data || {
            name: 'AUTOSERVICIO IM30',
            vat: '77283971-5',
            street: 'N/A',
            city: 'N/A',
            turn: 'COMERCIO',
            acteco: '471100'
        },
        payment_methods: [{ id: 1, name: 'Transbank IM30' }]
    };

    log.info(' Datos IM30 adaptados correctamente');
    log.info(`  - Empresa: ${session_data.company_data.name}`);
    log.info(`  - TBK Auth: ${tbk_data.authorization_code}`);
    log.info(`  - Terminal: ${tbk_data.terminal_id}`);
    log.info(`  - Comercio: ${tbk_data.codigo_comercio}`);
    log.info(`  - Monto: $${tbk_data.amount}`);
    log.info(`  - Productos: ${sale_data.products.length}`);

    return {
        tbk_data,
        sale_data,
        session_data,
        _source: 'autoservicio-im30',
        _timestamp: new Date().toISOString()
    };
}

export default router;