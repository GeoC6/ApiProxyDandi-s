import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function getDatabasePath() {
    let dbPath;

    try {
        let app = null;
        try {
            const electron = await import('electron');
            app = electron.app;
        } catch (electronError) {
            app = null;
        }

        if (app && app.getPath) {
            const userDataPath = app.getPath('userData');
            if (!fs.existsSync(userDataPath)) {
                fs.mkdirSync(userDataPath, { recursive: true });
            }
            dbPath = join(userDataPath, 'cache.db');
            console.log('Usando ruta Electron:', dbPath);
        } else {
            dbPath = join(__dirname, 'cache.db');
            console.log('Usando ruta desarrollo:', dbPath);
        }
    } catch (error) {
        dbPath = join(__dirname, 'cache.db');
        console.log('Usando ruta fallback:', dbPath);
    }

    return dbPath;
}

const dbPath = await getDatabasePath();

export const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error conectando SQLite:', err.message);
        console.error('Ruta intentada:', dbPath);
    } else {
        console.log('SQLite conectado:', dbPath);
    }
});

export const initDatabase = () => {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run(`
                CREATE TABLE IF NOT EXISTS transactions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    transaction_data TEXT NOT NULL,
                    status TEXT DEFAULT 'pending',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    processed_at DATETIME,
                    error_message TEXT
                )
            `, (err) => {
                if (err) {
                    console.error('Error creando tabla transactions:', err.message);
                    reject(err);
                    return;
                }
            });

            db.run(`ALTER TABLE transactions ADD COLUMN folio_dte TEXT`, () => { });
            db.run(`ALTER TABLE transactions ADD COLUMN dte_response TEXT`, () => { });
            db.run(`ALTER TABLE transactions ADD COLUMN order_number TEXT`, () => { });
            db.run(`ALTER TABLE transactions ADD COLUMN order_status TEXT DEFAULT 'pendiente'`, () => { });
            db.run(`ALTER TABLE transactions ADD COLUMN terminal_letter TEXT`, () => { });
            db.run(`ALTER TABLE transactions ADD COLUMN sequence_number INTEGER`, () => { });
            db.run(`ALTER TABLE transactions ADD COLUMN status_updated_at DATETIME`, () => { });
            db.run(`ALTER TABLE transactions ADD COLUMN source TEXT DEFAULT 'autoservicio'`, () => { });
            db.run(`ALTER TABLE transactions ADD COLUMN session_id INTEGER`, () => { });
            db.run(`ALTER TABLE transactions ADD COLUMN display_data TEXT`, () => { });
            db.run(`ALTER TABLE transactions ADD COLUMN whatsapp_number TEXT`, () => { });
            db.run(`ALTER TABLE transactions ADD COLUMN is_internal_voucher INTEGER DEFAULT 0`, () => { });
            db.run(`ALTER TABLE transactions ADD COLUMN internal_voucher_number TEXT`, () => { });

            db.run(`
                CREATE TABLE IF NOT EXISTS session_letters (
                    session_id INTEGER PRIMARY KEY,
                    assigned_letter TEXT NOT NULL,
                    terminal_name TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) {
                    console.error('Error creando tabla session_letters:', err.message);
                    reject(err);
                    return;
                }
            });

            db.run(`
                CREATE TABLE IF NOT EXISTS daily_sequences (
                    date TEXT PRIMARY KEY,
                    sequences TEXT NOT NULL DEFAULT '{}',
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) {
                    console.error('Error creando tabla daily_sequences:', err.message);
                    reject(err);
                    return;
                }
            });

            db.run(`
                CREATE TABLE IF NOT EXISTS cached_images (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    product_id INTEGER NOT NULL,
                    image_data TEXT NOT NULL,
                    mime_type TEXT DEFAULT 'image/jpeg',
                    cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(product_id)
                )
            `, (err) => {
                if (err) {
                    console.error('Error creando tabla cached_images:', err.message);
                    reject(err);
                    return;
                }
            });

            db.run(`
                CREATE TABLE IF NOT EXISTS internal_voucher_sequences (
                    prefix TEXT NOT NULL,
                    session_id INTEGER NOT NULL,
                    last_number INTEGER DEFAULT 0,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (prefix, session_id)
                )
            `, (err) => {
                if (err) {
                    console.error('Error creando tabla internal_voucher_sequences:', err.message);
                    reject(err);
                    return;
                }
            });

            db.run(`
                CREATE TABLE IF NOT EXISTS settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `, (err) => {
                if (err) {
                    console.error('Error creando tabla settings:', err.message);
                    reject(err);
                    return;
                }

                console.log('Tablas creadas/actualizadas correctamente');
                resolve();
            });
        });
    });
};

export const saveTransaction = (data) => {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare(`
            INSERT INTO transactions (transaction_data) 
            VALUES (?)
        `);

        stmt.run(JSON.stringify(data), function (err) {
            if (err) {
                reject(err);
            } else {
                console.log(`Transacción guardada ID: ${this.lastID}`);
                resolve(this.lastID);
            }
        });
        stmt.finalize();
    });
};

export const getPendingTransactions = () => {
    return new Promise((resolve, reject) => {
        db.all(`
            SELECT * FROM transactions 
            WHERE status = 'pending' 
            ORDER BY created_at ASC, id ASC
        `, (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
};

export const markAsCompleted = (id) => {
    return new Promise((resolve, reject) => {
        db.run(`
            UPDATE transactions 
            SET status = 'completed', processed_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        `, [id], function (err) {
            if (err) {
                reject(err);
            } else {
                resolve(this.changes);
            }
        });
    });
};

export const markAsFailed = (id, errorMessage) => {
    return new Promise((resolve, reject) => {
        db.run(`
            UPDATE transactions 
            SET status = 'failed', error_message = ?, processed_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        `, [errorMessage, id], function (err) {
            if (err) {
                reject(err);
            } else {
                resolve(this.changes);
            }
        });
    });
};

export const saveDTEResponse = (id, folioNumber, dteResponse) => {
    return new Promise((resolve, reject) => {
        db.run(`
            UPDATE transactions 
            SET folio_dte = ?, dte_response = ?
            WHERE id = ?
        `, [folioNumber, JSON.stringify(dteResponse), id], function (err) {
            if (err) {
                reject(err);
            } else {
                resolve(this.changes);
            }
        });
    });
};

export const getDTEResponse = (id) => {
    return new Promise((resolve, reject) => {
        db.get(`
            SELECT folio_dte, dte_response FROM transactions WHERE id = ?
        `, [id], (err, row) => {
            if (err) {
                reject(err);
            } else {
                if (row && row.dte_response) {
                    resolve({
                        folio: row.folio_dte,
                        response: JSON.parse(row.dte_response)
                    });
                } else {
                    resolve(null);
                }
            }
        });
    });
};

export const getOrAssignSessionLetter = (sessionId, terminalName = null) => {
    return new Promise((resolve, reject) => {
        db.get(`
            SELECT assigned_letter FROM session_letters WHERE session_id = ?
        `, [sessionId], (err, row) => {
            if (err) {
                reject(err);
                return;
            }

            if (row) {
                db.run(`
                    UPDATE session_letters 
                    SET last_used_at = CURRENT_TIMESTAMP 
                    WHERE session_id = ?
                `, [sessionId], (updateErr) => {
                    if (updateErr) {
                        console.error('Error actualizando last_used_at:', updateErr.message);
                    }
                });
                resolve(row.assigned_letter);
                return;
            }

            db.all(`
                SELECT DISTINCT assigned_letter 
                FROM session_letters 
                WHERE date(created_at) = date('now')
                ORDER BY assigned_letter
            `, (err, usedLetters) => {
                if (err) {
                    reject(err);
                    return;
                }

                const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
                const used = usedLetters.map(row => row.assigned_letter);
                let nextLetter = 'A';

                for (let i = 0; i < alphabet.length; i++) {
                    if (!used.includes(alphabet[i])) {
                        nextLetter = alphabet[i];
                        break;
                    }
                }

                db.run(`
                    INSERT INTO session_letters (session_id, assigned_letter, terminal_name)
                    VALUES (?, ?, ?)
                `, [sessionId, nextLetter, terminalName], function (insertErr) {
                    if (insertErr) {
                        reject(insertErr);
                    } else {
                        console.log(`Letra ${nextLetter} asignada a sesión ${sessionId}`);
                        resolve(nextLetter);
                    }
                });
            });
        });
    });
};

export const saveTransactionWithOrder = (
    data,
    sessionId,
    source = 'autoservicio',
    terminalName = null,
    whatsappNumber = null,
    dteResponse = null,
    isInternalVoucher = false,
    voucherNumber = null
) => {
    return new Promise(async (resolve, reject) => {
        try {
            const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
            const letter = alphabet[Math.floor(Math.random() * alphabet.length)];

            const sequenceNumber = Math.floor(Math.random() * 100);
            const formattedNumber = sequenceNumber.toString().padStart(2, '0');
            const orderNumber = `${letter}${formattedNumber}`;

            const folioNumber = dteResponse?.folio || null;
            const dteResponseJson = dteResponse ? JSON.stringify(dteResponse) : null;

            const stmt = db.prepare(`
                INSERT INTO transactions (
                    transaction_data, 
                    order_number, 
                    order_status, 
                    terminal_letter, 
                    sequence_number, 
                    status_updated_at,
                    source,
                    session_id,
                    whatsapp_number,
                    folio_dte,
                    dte_response,
                    is_internal_voucher,
                    internal_voucher_number
                ) VALUES (?, ?, 'pendiente', ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?)
            `);

            stmt.run([
                JSON.stringify(data),
                orderNumber,
                letter,
                sequenceNumber,
                source,
                sessionId,
                whatsappNumber,
                folioNumber,
                dteResponseJson,
                isInternalVoucher ? 1 : 0,
                voucherNumber
            ], function (err) {
                if (err) {
                    reject(err);
                } else {
                    console.log(`Transacción con orden ${orderNumber} guardada ID: ${this.lastID}`);

                    if (whatsappNumber) {
                        console.log(`WhatsApp registrado: ${whatsappNumber}`);
                    }

                    if (isInternalVoucher) {
                        console.log(`Vale interno registrado: ${voucherNumber}`);
                    } else if (folioNumber) {
                        console.log(`Folio DTE registrado: ${folioNumber}`);
                    }

                    resolve({
                        transactionId: this.lastID,
                        orderNumber: orderNumber,
                        letter: letter,
                        sequenceNumber: sequenceNumber
                    });
                }
            });
            stmt.finalize();

        } catch (error) {
            reject(error);
        }
    });
};

export const updateOrderStatus = (transactionId, newStatus) => {
    return new Promise((resolve, reject) => {
        const validStatuses = ['pendiente', 'en_preparacion', 'listo', 'entregado'];

        if (!validStatuses.includes(newStatus)) {
            reject(new Error(`Estado inválido: ${newStatus}`));
            return;
        }

        db.run(`
            UPDATE transactions 
            SET order_status = ?, status_updated_at = CURRENT_TIMESTAMP 
            WHERE id = ?
        `, [newStatus, transactionId], function (err) {
            if (err) {
                reject(err);
            } else {
                if (this.changes > 0) {
                    console.log(`Orden ID ${transactionId} actualizada a estado: ${newStatus}`);
                    resolve(this.changes);
                } else {
                    reject(new Error(`No se encontró transacción con ID: ${transactionId}`));
                }
            }
        });
    });
};

export const getOrdersForDisplay = (includeCompleted = false) => {
    return new Promise((resolve, reject) => {
        let whereClause = "WHERE order_number IS NOT NULL";

        if (!includeCompleted) {
            whereClause += " AND order_status IN ('pendiente', 'en_preparacion', 'listo')";
        }

        db.all(`
            SELECT 
                id,
                order_number,
                order_status,
                terminal_letter,
                sequence_number,
                source,
                session_id,
                created_at,
                status_updated_at,
                is_internal_voucher,
                internal_voucher_number
            FROM transactions 
            ${whereClause}
            ORDER BY created_at DESC
        `, (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
};

export const getDeliveredOrders = (limit = 50) => {
    return new Promise((resolve, reject) => {
        db.all(`
            SELECT 
                id,
                order_number,
                order_status,
                terminal_letter,
                sequence_number,
                source,
                session_id,
                created_at,
                status_updated_at,
                is_internal_voucher,
                internal_voucher_number
            FROM transactions 
            WHERE order_number IS NOT NULL 
            AND order_status = 'entregado'
            ORDER BY status_updated_at DESC
            LIMIT ?
        `, [limit], (err, rows) => {
            if (err) {
                reject(err);
            } else {
                resolve(rows);
            }
        });
    });
};

export const getOrderWhatsapp = (transactionId) => {
    return new Promise((resolve, reject) => {
        db.get(`
            SELECT whatsapp_number, order_number, order_status
            FROM transactions 
            WHERE id = ?
        `, [transactionId], (err, row) => {
            if (err) {
                reject(err);
            } else {
                resolve(row);
            }
        });
    });
};

export const getSetting = (key, defaultValue = null) => {
    return new Promise((resolve) => {
        db.get(`SELECT value FROM settings WHERE key = ?`, [key], (err, row) => {
            if (err || !row) {
                resolve(defaultValue);
            } else {
                resolve(row.value);
            }
        });
    });
};

export const setSetting = (key, value) => {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
            [key, value],
            (err) => {
                if (err) reject(err);
                else resolve();
            }
        );
    });
};

export const getAllSettings = () => {
    return new Promise((resolve, reject) => {
        db.all(`SELECT key, value FROM settings`, [], (err, rows) => {
            if (err) reject(err);
            else {
                const obj = {};
                rows.forEach(r => { obj[r.key] = r.value; });
                resolve(obj);
            }
        });
    });
};

export const getNextInternalVoucherNumber = (prefix, sessionId) => {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            db.run(`
                INSERT OR IGNORE INTO internal_voucher_sequences (prefix, session_id, last_number) 
                VALUES (?, ?, 0)
            `, [prefix, sessionId], (err) => {
                if (err) {
                    reject(err);
                    return;
                }

                db.run(`
                    UPDATE internal_voucher_sequences 
                    SET last_number = last_number + 1, 
                        updated_at = CURRENT_TIMESTAMP 
                    WHERE prefix = ? AND session_id = ?
                `, [prefix, sessionId], function (err) {
                    if (err) {
                        reject(err);
                        return;
                    }

                    db.get(`
                        SELECT last_number FROM internal_voucher_sequences 
                        WHERE prefix = ? AND session_id = ?
                    `, [prefix, sessionId], (err, row) => {
                        if (err) {
                            reject(err);
                        } else {
                            const number = row.last_number.toString().padStart(4, '0');
                            const voucherNumber = `${prefix}-${sessionId}-${number}`;
                            console.log(`Número de vale generado: ${voucherNumber}`);
                            resolve(voucherNumber);
                        }
                    });
                });
            });
        });
    });
};