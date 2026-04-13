import axios from 'axios';
import { getPendingTransactions, markAsCompleted, markAsFailed, saveDTEResponse, getDTEResponse, getNextInternalVoucherNumber } from '../database.js';
import { log } from './logger.js';
import { addCriticalError } from '../routes/critical-errors.js';

const BACKGROUND_INTERVAL = parseInt(process.env.BACKGROUND_INTERVAL) || 30000;
const XSIGN_URL = process.env.XSIGN_URL || 'http://localhost:5999';
const ODOO_URL = process.env.ODOO_URL || 'https://dandis.posgo.cl';

const INTERNAL_VOUCHER_METHODS = {
    7: 'E',
    8: 'P',
    9: 'A'
};

let processorState = {
    isProcessing: false,
    currentTransactionId: null,
    lastProcessingTime: null,
    totalProcessed: 0,
    totalErrors: 0,
    lockTimestamp: null
};

let processingLock = false;

export function getProcessorState() {
    return { ...processorState };
}

function getSimpleErrorMessage(error) {
    if (error.code) {
        return `${error.code}${error.syscall ? ' ' + error.syscall : ''}`;
    }
    if (error.message) {
        if (error.message.includes('ENOTFOUND')) return 'ENOTFOUND (sin internet)';
        if (error.message.includes('ECONNREFUSED')) return 'ECONNREFUSED (servicio no disponible)';
        if (error.message.includes('ECONNRESET')) return 'ECONNRESET (conexión cortada)';
        if (error.message.includes('EHOSTUNREACH')) return 'EHOSTUNREACH (host no alcanzable)';
        if (error.message.includes('timeout')) return 'TIMEOUT (sin respuesta)';
        return error.message.split('\n')[0];
    }
    return 'Error desconocido';
}

function isTemporaryNetworkError(error) {
    const temporaryErrorCodes = [
        'ENOTFOUND',
        'ECONNREFUSED',
        'ECONNRESET',
        'EHOSTUNREACH',
        'ENETUNREACH',
        'ETIMEDOUT',
        'ECONNABORTED'
    ];

    if (temporaryErrorCodes.includes(error.code)) {
        return true;
    }

    if (error.message) {
        return temporaryErrorCodes.some(code =>
            error.message.includes(code) || error.message.includes('getaddrinfo')
        );
    }

    return false;
}

function isInternalVoucherTransaction(transactionData) {
    const paymentMethods = transactionData?.sale_data?.payments;
    if (!paymentMethods || !Array.isArray(paymentMethods)) {
        return false;
    }

    const paymentIds = paymentMethods.map(p => parseInt(p.id));
    return paymentIds.every(id => INTERNAL_VOUCHER_METHODS.hasOwnProperty(id));
}

function buildDTEData(transactionData) {
    const { tbk_data, sale_data, session_data } = transactionData;

    const dteData = {
        Encabezado: {
            IdDoc: {
                TipoDTE: 39,
                FchEmis: new Date().toISOString().split('T')[0]
            },
            Emisor: {
                RUTEmisor: session_data.company_data?.vat || '76.000.000-0',
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
                dteData.Detalle.push({
                    NroLinDet: lineNumber++,
                    CdgItem: {
                        TpoCodigo: "INT1",
                        VlrCodigo: product.id.toString()
                    },
                    NmbItem: product.name || `Producto ${product.id}`,
                    DscItem: product.customization || "N/A",
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

    return dteData;
}

async function generateDTE(transactionData) {
    log.info('Generando DTE...');

    const dteData = buildDTEData(transactionData);

    let baseUrl = XSIGN_URL;
    if (!baseUrl.includes('/sign/39')) {
        baseUrl = `${baseUrl}/sign/39`;
    }
    const finalUrl = `${baseUrl}?getTED=false&sendDTE=true`;

    try {
        log.info(`Enviando DTE a XSign: ${finalUrl}`);

        const response = await axios.post(finalUrl, dteData, {
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
                'withCredentials': 'true',
                'Access-Control-Allow-Origin': '*',
                'Accept': '*/*',
                'cache-control': 'no-cache'
            }
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

async function sendToOdoo(transactionData, dteResponse, isInternalVoucher = false, voucherNumber = null) {
    const { tbk_data, sale_data, session_data } = transactionData;

    log.info(`Enviando a Odoo autoservicio${isInternalVoucher ? ' (vale interno)' : ''}...`);

    let sourceTbk = tbk_data;
    if (sale_data.payments && Array.isArray(sale_data.payments)) {
        const paymentWithData = sale_data.payments.find(p => p.externalData && p.externalData.authorizationCode);
        if (paymentWithData) {
            sourceTbk = paymentWithData.externalData;
        }
    }

    const authCode = sourceTbk.authorization_code || sourceTbk.authorizationCode || tbk_data.authorization_code || "";
    const cardType = sourceTbk.card_type || sourceTbk.paymentTypeCode || tbk_data.card_type || "DB";
    const amount = (sourceTbk.amount || tbk_data.amount || 0).toString();
    const last4 = (sourceTbk.account_number || sourceTbk.ultimos_4_digitos || sourceTbk.cardDetail?.cardNumber || "").toString();
    const numOperacion = sourceTbk.num_operacion || sourceTbk.traceId || "";
    const ticket = sourceTbk.ticket || "";
    const terminal = sourceTbk.terminal_id || sourceTbk.terminalId || "POS-WIFI";
    const installments = sourceTbk.num_cuotas || 0;

    let paymentsForOdoo = [];

    if (sale_data.payments && Array.isArray(sale_data.payments)) {
        paymentsForOdoo = sale_data.payments.map(p => {
            return {
                id: p.id,
                monto: parseFloat(p.monto),
                VoucherNum: numOperacion,
                CreditCard: cardType,
                ConfNum: numOperacion,
                CrCardNum: last4,
                OwnerIdNum: authCode,
                NumOfPmnts: installments,
                U_Id_Terminal_POS: terminal,
                transbank_response: JSON.stringify(sourceTbk),
                transaction_id: authCode
            };
        });
    } else {
        paymentsForOdoo = [{
            id: session_data.payment_methods?.[0]?.id || 1,
            monto: parseFloat(tbk_data.amount),
            VoucherNum: numOperacion,
            CreditCard: cardType,
            ConfNum: numOperacion,
            CrCardNum: last4,
            OwnerIdNum: authCode,
            NumOfPmnts: installments,
            U_Id_Terminal_POS: terminal,
            transbank_response: JSON.stringify(tbk_data),
            transaction_id: authCode
        }];
    }

    const orderData = {
        session_id: parseInt(session_data.session_id),
        orders: [{
            products: [],
            payment: paymentsForOdoo,
            data_card: {
                res_amount: amount,
                res_authorization_code: authCode,
                res_real_date: sourceTbk.transactionDate || new Date().toISOString(),
                res_account_number: last4,
                res_ticket: ticket,
                res_terminal_id: terminal,
                res_card_type: cardType
            },
            tip_amount: parseFloat(sale_data.tip_amount || 0),
            customer_comment: sale_data.note || "",
            tipo_dte: isInternalVoucher ? '00' : 39,
            dte_folio: isInternalVoucher ? voucherNumber : (dteResponse?.folio || 0),
            dte_json: dteResponse ? JSON.stringify(dteResponse.originalDTE) : null,
            is_internal_voucher: isInternalVoucher,
            internal_voucher_number: isInternalVoucher ? voucherNumber : ''
        }]
    };

    if (sale_data.products && sale_data.products.length > 0) {
        sale_data.products.forEach(product => {
            if (product.cant > 0) {
                const productData = {
                    product_id: parseInt(product.id),
                    name: product.name,
                    qty: parseInt(product.cant),
                    price_subtotal: parseFloat(product.price * product.cant),
                    price_subtotal_incl: parseFloat((product.price * product.cant) * 1.19)
                };

                if (product.customization) {
                    productData.customization = product.customization;
                }

                if (product.selected_attributes) {
                    productData.selected_attributes = product.selected_attributes;
                }

                orderData.orders[0].products.push(productData);
            }
        });
    }

    log.info('Datos a enviar a Odoo:', JSON.stringify(orderData, null, 2));

    const response = await axios.post(`${ODOO_URL}/create_orders_from_self_service`, orderData, {
        timeout: 30000,
        headers: {
            'Content-Type': 'application/json'
        }
    });

    log.info('Respuesta de Odoo - Status:', response.status);
    log.info('Respuesta de Odoo - Data:', JSON.stringify(response.data, null, 2));

    if (response.status !== 200) {
        throw new Error(`Error enviando a Odoo: ${response.status}`);
    }

    if (response.data && response.data.error) {
        throw new Error(`Odoo retorno error: ${response.data.error}`);
    }

    log.success(`Enviado a Odoo autoservicio correctamente${isInternalVoucher ? ' (vale interno)' : ''}`);
    return response.data;
}

async function processTransaction(transaction) {
    const transactionData = JSON.parse(transaction.transaction_data);

    processorState.isProcessing = true;
    processorState.currentTransactionId = transaction.id;
    processorState.lastProcessingTime = new Date().toISOString();

    try {
        log.info(`Procesando transacción ID: ${transaction.id} (autoservicio)`);

        const isVoucher = isInternalVoucherTransaction(transactionData);
        let dteResponse = null;
        let voucherNumber = null;

        if (isVoucher) {
            log.info('═══════════════════════════════════════════════════════════');
            log.info(' VALE INTERNO DETECTADO - NO SE GENERARÁ DTE');
            log.info('═══════════════════════════════════════════════════════════');

            if (transaction.internal_voucher_number) {
                voucherNumber = transaction.internal_voucher_number;
                log.info(`  Número de vale existente: ${voucherNumber}`);
            } else {
                const paymentIds = transactionData.sale_data.payments.map(p => parseInt(p.id));
                const prefix = INTERNAL_VOUCHER_METHODS[paymentIds[0]] || 'V';
                const sessionId = transactionData.session_data.session_id;

                voucherNumber = await getNextInternalVoucherNumber(prefix, sessionId);
                log.info(`  Número de vale generado: ${voucherNumber}`);
            }

            log.info('═══════════════════════════════════════════════════════════');
        } else {
            const existingDTE = await getDTEResponse(transaction.id);

            if (existingDTE) {
                log.info(`Reutilizando DTE existente - Folio: ${existingDTE.folio}`);
                dteResponse = existingDTE.response;
                if (!dteResponse.originalDTE) {
                    dteResponse.originalDTE = buildDTEData(transactionData);
                }
            } else {
                dteResponse = await generateDTE(transactionData);
                await saveDTEResponse(transaction.id, dteResponse.folio, dteResponse);
            }
        }

        await sendToOdoo(transactionData, dteResponse, isVoucher, voucherNumber);

        await markAsCompleted(transaction.id);

        processorState.totalProcessed++;

        if (isVoucher) {
            log.success(`Transacción ${transaction.id} completada exitosamente (vale interno ${voucherNumber})`);
        } else {
            log.success(`Transacción ${transaction.id} completada exitosamente con folio ${dteResponse.folio}`);
        }

        return true;

    } catch (error) {
        const isTemporary = isTemporaryNetworkError(error);
        const simpleError = getSimpleErrorMessage(error);

        if (isTemporary) {
            log.warn(`Error temporal en transacción ${transaction.id} - Reintentando después: ${simpleError}`);
            return false;
        } else {
            log.error(`Error permanente procesando transacción ${transaction.id}: ${simpleError}`);

            if (error.message.includes('XSign Error 400') ||
                error.message.includes('No hay Folios Disponibles') ||
                error.message.includes('no hay folios disponibles') ||
                error.message.includes('No hay folios') ||
                error.message.includes('no hay folios')) {

                log.error(`DETECTADO ERROR DE FOLIOS: ${error.message}`);

                addCriticalError({
                    message: 'No hay folios DTE disponibles - Contacte soporte técnico inmediatamente',
                    type: 'critical',
                    source: 'XSign',
                    transaction_id: transaction.id
                });
            }

            await markAsFailed(transaction.id, error.message);
            processorState.totalErrors++;

            return false;
        }
    } finally {
        processorState.isProcessing = false;
        processorState.currentTransactionId = null;
    }
}

async function processBackground() {
    if (processingLock) {
        log.info('Procesador bloqueado, otra instancia ejecutándose');
        return;
    }

    if (processorState.isProcessing) {
        log.info('Procesador ya ejecutándose, saltando...');
        return;
    }

    processingLock = true;
    processorState.isProcessing = true;
    processorState.lockTimestamp = Date.now();

    try {
        let continuousProcessing = true;

        while (continuousProcessing) {
            const pendingTransactions = await getPendingTransactions();

            if (pendingTransactions.length === 0) {
                log.info('No hay transacciones pendientes');
                continuousProcessing = false;
                break;
            }

            const oldestTransaction = pendingTransactions[0];

            log.info(`Procesando transacción más antigua ID: ${oldestTransaction.id} (${pendingTransactions.length} en cola)`);

            try {
                const success = await processTransaction(oldestTransaction);

                if (success) {
                    log.success(`Transacción ${oldestTransaction.id} completada exitosamente, continuando con la siguiente...`);

                    await new Promise(resolve => setTimeout(resolve, 500));
                } else {
                    log.warn(`Transacción ${oldestTransaction.id} falló, deteniendo procesamiento continuo`);
                    continuousProcessing = false;
                }

            } catch (error) {
                const simpleError = getSimpleErrorMessage(error);
                log.error(`Error inesperado procesando transacción ${oldestTransaction.id}: ${simpleError}`);
                continuousProcessing = false;
            }
        }

    } catch (error) {
        const simpleError = getSimpleErrorMessage(error);
        log.error('Error en procesador background:', simpleError);
        processorState.totalErrors++;
    } finally {
        processorState.isProcessing = false;
        processingLock = false;
        processorState.lockTimestamp = null;
    }
}

export function startBackgroundProcessor() {
    log.info(`Iniciando procesador background (cada ${BACKGROUND_INTERVAL / 1000}s)`);

    setTimeout(processBackground, 5000);

    setInterval(processBackground, BACKGROUND_INTERVAL);

    log.success('Procesador background iniciado');
}