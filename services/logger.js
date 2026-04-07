import { EventEmitter } from 'events';

class LogAggregator extends EventEmitter {
    constructor() {
        super();
        this.logBuffer = new Map();
        this.summaryInterval = 60000; // 1 minuto
        this.lastSummary = Date.now();
        this.criticalLogs = [];

        this.realtimeBuffer = [];
        this.maxRealtimeBuffer = 500;
        this.streamingClients = new Set();

        this.filters = {
            groupable: [
                'Proxy Odoo',
                'GET /api/sync-status',
                'GET /api/critical-errors',
                'GET /api/pos_session_token',
                'GET /api/pos_sessions_data',
                'Odoo sessions data OK',
                'Odoo session token OK',
                'No hay transacciones pendientes'
            ],
            immediate: [
                'Procesando transacción',
                'completada exitosamente',
                'Error procesando',
                'DTE generado',
                'Enviado a Odoo',
                'ERROR DE FOLIOS',
                'iniciada en puerto',
                'Procesador background iniciado'
            ]
        };

        this.startSummaryTimer();
    }

    addStreamingClient(response) {
        this.streamingClients.add(response);

        this.realtimeBuffer.forEach(logEntry => {
            this.sendToClient(response, logEntry);
        });

        console.log(`[STREAM] Cliente conectado (${this.streamingClients.size} activos)`);
    }

    removeStreamingClient(response) {
        this.streamingClients.delete(response);
        console.log(`[STREAM] Cliente desconectado (${this.streamingClients.size} activos)`);
    }

    sendToClient(response, logEntry) {
        try {
            const data = `data: ${JSON.stringify(logEntry)}\n\n`;
            response.write(data);
        } catch (error) {
            this.removeStreamingClient(response);
        }
    }

    broadcastToClients(logEntry) {
        const disconnectedClients = [];

        this.streamingClients.forEach(response => {
            try {
                this.sendToClient(response, logEntry);
            } catch (error) {
                disconnectedClients.push(response);
            }
        });

        disconnectedClients.forEach(client => {
            this.removeStreamingClient(client);
        });
    }

    addToRealtimeBuffer(level, message, data = null) {
        const logEntry = {
            id: Date.now() + Math.random(),
            timestamp: new Date().toISOString(),
            level,
            message,
            data
        };

        this.realtimeBuffer.push(logEntry);

        if (this.realtimeBuffer.length > this.maxRealtimeBuffer) {
            this.realtimeBuffer = this.realtimeBuffer.slice(-this.maxRealtimeBuffer);
        }

        this.broadcastToClients(logEntry);
        this.emit('log', logEntry);
    }

    shouldShowImmediately(message) {
        if (message.includes('Error') || message.includes('DETECTADO')) {
            return true;
        }

        return this.filters.immediate.some(pattern =>
            message.toLowerCase().includes(pattern.toLowerCase())
        );
    }

    shouldGroup(message) {
        return this.filters.groupable.some(pattern =>
            message.toLowerCase().includes(pattern.toLowerCase())
        );
    }

    addToBuffer(level, message, data = null) {
        const key = this.generateKey(message);

        if (!this.logBuffer.has(key)) {
            this.logBuffer.set(key, {
                level,
                message: this.cleanMessage(message),
                count: 0,
                lastSeen: Date.now(),
                data: data
            });
        }

        const entry = this.logBuffer.get(key);
        entry.count++;
        entry.lastSeen = Date.now();

        if (data) {
            entry.data = data;
        }
    }

    generateKey(message) {
        let key = message
            .replace(/\[.*?\]/g, '')
            .replace(/ID: \d+/g, 'ID: X')
            .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, 'TIMESTAMP')
            .replace(/\d+/g, 'NUM')
            .trim();

        return key;
    }

    cleanMessage(message) {
        return message
            .replace(/\[.*?\] /, '')
            .replace(/"/g, '');
    }

    printSummary() {
        const now = Date.now();
        const timeSinceLastSummary = (now - this.lastSummary) / 1000;

        if (this.logBuffer.size === 0) {
            return;
        }

        console.log(`\n[SUMMARY] Resumen de logs (últimos ${Math.round(timeSinceLastSummary)}s)`);

        const totalLogs = Array.from(this.logBuffer.values())
            .reduce((sum, entry) => sum + entry.count, 0);

        console.log(`[STATS] ${totalLogs} operaciones registradas`);

        if (this.streamingClients.size > 0) {
            console.log(`[STREAM] ${this.streamingClients.size} clientes conectados`);
        }

        const byLevel = new Map();

        for (const [key, entry] of this.logBuffer) {
            if (!byLevel.has(entry.level)) {
                byLevel.set(entry.level, []);
            }
            byLevel.get(entry.level).push(entry);
        }

        ['error', 'warn', 'info', 'success'].forEach(level => {
            if (byLevel.has(level)) {
                const entries = byLevel.get(level);
                console.log(`\n[${level.toUpperCase()}]:`);

                entries
                    .sort((a, b) => b.count - a.count)
                    .forEach(entry => {
                        const countStr = entry.count > 1 ? ` (x${entry.count})` : '';
                        console.log(`  - ${entry.message}${countStr}`);
                    });
            }
        });

        console.log(`\n[INFO] Próximo resumen: ${new Date(Date.now() + this.summaryInterval).toLocaleTimeString()}\n`);

        this.logBuffer.clear();
        this.lastSummary = now;
    }

    startSummaryTimer() {
        setInterval(() => {
            this.printSummary();
        }, this.summaryInterval);
    }

    log(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const fullMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

        this.addToRealtimeBuffer(level, message, data);

        if (this.shouldShowImmediately(message)) {
            if (level === 'error') {
                console.error(fullMessage, data ? JSON.stringify(data, null, 2) : '');
            } else if (level === 'warn') {
                console.warn(fullMessage, data ? JSON.stringify(data, null, 2) : '');
            } else {
                console.log(fullMessage, data ? JSON.stringify(data, null, 2) : '');
            }
            return;
        }

        if (this.shouldGroup(message)) {
            this.addToBuffer(level, message, data);
            return;
        }

        if (level === 'error') {
            console.error(fullMessage, data ? JSON.stringify(data, null, 2) : '');
        } else if (level === 'warn') {
            console.warn(fullMessage, data ? JSON.stringify(data, null, 2) : '');
        } else {
            console.log(fullMessage, data ? JSON.stringify(data, null, 2) : '');
        }
    }

    getRealtimeBuffer() {
        return [...this.realtimeBuffer];
    }

    getStats() {
        return {
            connectedClients: this.streamingClients.size,
            bufferSize: this.realtimeBuffer.length,
            maxBufferSize: this.maxRealtimeBuffer,
            summaryInterval: this.summaryInterval,
            nextSummary: new Date(this.lastSummary + this.summaryInterval).toISOString()
        };
    }
}

const logAggregator = new LogAggregator();

export const log = {
    info: (message, data = null) => {
        logAggregator.log('info', message, data);
    },

    success: (message, data = null) => {
        logAggregator.log('success', message, data);
    },

    error: (message, error = null) => {
        logAggregator.log('error', message, error ? error.message || error : null);
    },

    warn: (message, data = null) => {
        logAggregator.log('warn', message, data);
    },

    showSummary: () => {
        logAggregator.printSummary();
    },

    setSummaryInterval: (ms) => {
        logAggregator.summaryInterval = ms;
    },

    addStreamingClient: (response) => {
        logAggregator.addStreamingClient(response);
    },

    removeStreamingClient: (response) => {
        logAggregator.removeStreamingClient(response);
    },

    getRealtimeBuffer: () => {
        return logAggregator.getRealtimeBuffer();
    },

    getStats: () => {
        return logAggregator.getStats();
    }
};

export { logAggregator };