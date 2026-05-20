import { promisify } from 'util';
import { exec } from 'child_process';
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { log } from './logger.js';
import { getSetting } from '../database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execAsync = promisify(exec);

const ESC = '\x1B';
const GS = '\x1D';

const CENTER = `${ESC}\x61\x01`;
const LEFT = `${ESC}\x61\x00`;
const BOLD_ON = `${ESC}\x45\x01`;
const BOLD_OFF = `${ESC}\x45\x00`;
const SIZE_NORMAL = `${GS}\x21\x00`;
const SIZE_DOUBLE = `${GS}\x21\x11`;
const SIZE_HUGE = `${GS}\x21\x33`;

class PrinterService {
    constructor() {
        this.tempDir = path.join(os.tmpdir(), 'comandas');
    }

    getExePath() {
        if (__dirname.includes('app.asar')) {
            return path.join(path.dirname(path.dirname(__dirname)), 'app.asar.unpacked', 'PrinterHelper.exe');
        }
        return path.join(__dirname, '..', 'PrinterHelper.exe');
    }

    getEnvValue(key) {
        const envPath = path.join(__dirname, '..', '.env');
        try {
            const content = fsSync.readFileSync(envPath, 'utf8');
            const match = content.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, 'm'));
            if (match) return match[1].trim();
        } catch (e) {
            log.warn(`No se pudo leer .env desde ${envPath}: ${e.message}`);
        }
        return process.env[key] || null;
    }

    async getPrinterName() {
        try {
            const saved = await getSetting('PRINTER_TICKET_NAME');
            if (saved) return saved;
        } catch (e) {}
        return this.getEnvValue('PRINTER_TICKET_NAME') || 'POS';
    }

    async ensureTempDir() {
        try {
            await fs.mkdir(this.tempDir, { recursive: true });
        } catch (error) {
            log.error('Error creando directorio temporal:', error.message);
        }
    }

    async getPrinters() {
        try {
            const { stdout } = await execAsync(
                'powershell -Command "Get-Printer | Select-Object -ExpandProperty Name"',
                { encoding: 'utf8' }
            );
            return stdout.split('\n').map(l => l.trim()).filter(l => l.length > 0).map(name => ({ name }));
        } catch (error) {
            log.error('Error obteniendo impresoras:', error.message);
            return [];
        }
    }

    async printOrderTicket(orderNumber, orderData = null) {
        const printerName = await this.getPrinterName();
        const exePath = this.getExePath();

        log.info('══════════════════════════════════════');
        log.info(' INICIANDO IMPRESION TICKET CLIENTE');
        log.info(`  Orden:     ${orderNumber}`);
        log.info(`  Impresora: "${printerName}"`);
        log.info(`  .env path: ${path.join(__dirname, '..', '.env')}`);
        log.info(`  exe path:  ${exePath}`);
        log.info(`  exe existe: ${fsSync.existsSync(exePath)}`);

        try {
            const printers = await this.getPrinters();
            if (printers.length === 0) {
                log.warn('  No se encontraron impresoras en el sistema');
            } else {
                log.info(`  Impresoras disponibles (${printers.length}):`);
                printers.forEach((p, i) => {
                    const match = p.name.trim().toLowerCase() === printerName.trim().toLowerCase();
                    log.info(`    ${i + 1}. "${p.name}"${match ? '  << MATCH' : ''}`);
                });
                const found = printers.find(p =>
                    p.name.trim().toLowerCase() === printerName.trim().toLowerCase()
                );
                if (!found) {
                    log.warn(`  ADVERTENCIA: No hay impresora con nombre exacto "${printerName}"`);
                }
            }
        } catch (listError) {
            log.warn('  No se pudo listar impresoras:', listError.message);
        }

        try {
            const time = new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
            const note = orderData?.sale_data?.note || '';
            let orderTypeLabel = '';
            let customerNote = '';

            if (note.includes('[PARA LLEVAR]')) {
                orderTypeLabel = 'PARA LLEVAR';
                customerNote = note.replace('[PARA LLEVAR]', '').trim();
            } else if (note.includes('[MESA / SERVIR]')) {
                orderTypeLabel = 'MESA / SERVIR';
                customerNote = note.replace('[MESA / SERVIR]', '').trim();
            } else {
                customerNote = note.trim();
            }

            const products = orderData?.sale_data?.products || [];

            let ticket = '';
            ticket += CENTER;
            ticket += '================================\n';
            ticket += BOLD_ON + SIZE_DOUBLE;
            ticket += 'ORDEN CLIENTE\n';
            ticket += SIZE_NORMAL + BOLD_OFF;
            ticket += '================================\n';
            ticket += '\n';
            ticket += SIZE_HUGE;
            ticket += `${orderNumber}\n`;
            ticket += SIZE_NORMAL;
            ticket += '\n';

            if (orderTypeLabel) {
                ticket += BOLD_ON;
                ticket += `>> ${orderTypeLabel} <<\n`;
                ticket += BOLD_OFF;
                ticket += '\n';
            }

            ticket += '================================\n';

            if (products.length > 0) {
                ticket += LEFT;
                products.forEach(item => {
                    ticket += '\n';
                    ticket += BOLD_ON;
                    ticket += `${item.cant}x  ${item.name}\n`;
                    ticket += BOLD_OFF;

                    if (Array.isArray(item.attribute_lines) && item.attribute_lines.length > 0) {
                        item.attribute_lines.forEach(attr => {
                            const ingredient = attr.name || '';
                            const qty = attr.qty > 1 ? ` x${attr.qty}` : '';
                            const price = attr.price ? parseFloat(attr.price) : 0;
                            const isAddition = attr.is_addition || false;

                            // Calcular el valor total del atributo
                            const totalAttrPrice = price * (attr.qty || 1);
                            const priceText = (isAddition && totalAttrPrice > 0) ? ` +$${totalAttrPrice}` : '';

                            if (ingredient) {
                                ticket += `  - ${ingredient}${qty}${priceText}\n`;
                            }
                        });
                    }

                    if (item.customization && !(Array.isArray(item.attribute_lines) && item.attribute_lines.length > 0)) {
                        ticket += `  * ${item.customization}\n`;
                    }
                });
                ticket += '\n';
                ticket += CENTER;
                ticket += '================================\n';
            }

            if (customerNote) {
                ticket += LEFT;
                ticket += '================================\n';
                ticket += BOLD_ON;
                ticket += 'NOTA DEL PEDIDO:\n';
                ticket += BOLD_OFF;
                ticket += `${customerNote}\n`;
                ticket += '================================\n';
            }

            ticket += CENTER;
            ticket += '================================\n';
            ticket += `${time}\n`;
            ticket += '================================\n';
            ticket += '\n\n\n\n';

            await this.ensureTempDir();
            const filepath = path.join(this.tempDir, `ticket_${orderNumber}_${Date.now()}.txt`);
            await fs.writeFile(filepath, ticket, 'utf8');
            log.info(`  Archivo: ${filepath}`);

            const cmd = `"${exePath}" "${printerName}" "${filepath}"`;
            log.info(`  Ejecutando: ${cmd}`);

            const { stdout, stderr } = await execAsync(cmd, { timeout: 10000 });
            log.info(`  stdout: "${stdout.trim()}"`);
            if (stderr) log.warn(`  stderr: "${stderr.trim()}"`);

            if (!stdout.includes('OK')) throw new Error(`PrinterHelper: ${stdout.trim()}`);

            log.success(`  Ticket ${orderNumber} impreso OK`);
            log.info('══════════════════════════════════════');

            setTimeout(() => fs.unlink(filepath).catch(() => { }), 3000);

        } catch (error) {
            log.error(`  FALLO impresion ${orderNumber}: ${error.message}`);
            log.info('══════════════════════════════════════');
        }
    }

    async printOrderNumber(orderNumber) {
        const printerName = await this.getPrinterName();
        const exePath = this.getExePath();

        log.info('══════════════════════════════════════');
        log.info(' IMPRIMIENDO NUMERO DE ORDEN');
        log.info(`  Orden:     ${orderNumber}`);
        log.info(`  Impresora: "${printerName}"`);

        try {
            let ticket = '';
            ticket += CENTER;
            ticket += '\n';
            ticket += '================================\n';
            ticket += '\n';
            ticket += SIZE_HUGE + BOLD_ON;
            ticket += `${orderNumber}\n`;
            ticket += BOLD_OFF + SIZE_NORMAL;
            ticket += '\n';
            ticket += '================================\n';
            ticket += '\n\n\n\n';

            await this.ensureTempDir();
            const filepath = path.join(this.tempDir, `orden_${orderNumber}_${Date.now()}.txt`);
            await fs.writeFile(filepath, ticket, 'utf8');

            const cmd = `"${exePath}" "${printerName}" "${filepath}"`;
            log.info(`  Ejecutando: ${cmd}`);

            const { stdout, stderr } = await execAsync(cmd, { timeout: 10000 });
            log.info(`  stdout: "${stdout.trim()}"`);
            if (stderr) log.warn(`  stderr: "${stderr.trim()}"`);

            if (!stdout.includes('OK')) throw new Error(`PrinterHelper: ${stdout.trim()}`);

            log.success(`  Número de orden ${orderNumber} impreso OK`);
            log.info('══════════════════════════════════════');

            setTimeout(() => fs.unlink(filepath).catch(() => { }), 3000);

        } catch (error) {
            log.error(`  FALLO impresion número de orden ${orderNumber}: ${error.message}`);
            log.info('══════════════════════════════════════');
        }
    }

    async listAvailablePrinters() {
        const printers = await this.getPrinters();
        if (!printers || printers.length === 0) {
            log.warn('No se encontraron impresoras');
            return [];
        }
        printers.forEach((p, i) => log.info(`${i + 1}. "${p.name}"`));
        return printers;
    }
}

export default new PrinterService();