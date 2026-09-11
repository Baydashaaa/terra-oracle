/**
 * Oracle Draw V2 - DrawState
 * Состояние пула. Фаза здесь одна и единственная - производных флагов
 * (animation / replay / revealed) нет, они выводятся из неё.
 */

import { CONFIG } from "./Config.js";
import { PHASE, PHASE_RULES } from "./DrawPhase.js";

const safeStorage = {
    read(key) { try { return window.localStorage.getItem(key); } catch { return null; } },
    write(key, value) { try { window.localStorage.setItem(key, value); } catch { /* ignore */ } }
};

export default class DrawState {

    constructor(pool = CONFIG.DAILY) {
        this.reset(pool);
    }

    reset(pool = this.pool) {
        this.pool = pool;
        this.phase = PHASE.OPEN;
        this.roundKey = null;
        this.round = null;
        this.model = null;          // TicketModel текущего раунда
        this.verified = false;      // winner_index сошёлся с адресом
        this.hydrated = false;
        this.revealing = false;
        this.lastUpdateAt = 0;
        this.lastError = null;
    }

    applyRound(round, model, verified) {
        this.round = round;
        this.roundKey = round.key;
        this.model = model || null;
        this.verified = !!verified;
    }

    get rules() { return PHASE_RULES[this.phase] || PHASE_RULES[PHASE.OPEN]; }

    /* ---------- память просмотренных раундов ---------- */

    #seen() {
        const raw = safeStorage.read(CONFIG.STORAGE_KEY);
        if (!raw) return [];
        try { const l = JSON.parse(raw); return Array.isArray(l) ? l : []; } catch { return []; }
    }

    hasSeen(key) { return this.#seen().includes(key); }

    markSeen(key) {
        const list = this.#seen();
        if (list.includes(key)) return;
        list.push(key);
        while (list.length > CONFIG.STORAGE_LIMIT) list.shift();
        safeStorage.write(CONFIG.STORAGE_KEY, JSON.stringify(list));
    }

    snapshot() {
        const r = this.round;
        return {
            pool: this.pool,
            phase: this.phase,
            round: r ? r.key : null,
            date: r ? r.date : null,
            entriesOpen: this.rules.entriesOpen,
            showsResult: this.rules.showsResult,
            winner: r ? r.winner : null,
            winnerIndex: r ? r.winnerIndex : null,
            prize: r ? r.prize : 0,
            winners: r ? r.winners.slice() : [],
            skipped: r ? r.skipped : false,
            sectors: this.model ? this.model.sectorCount : 0,
            tickets: this.model ? this.model.total : 0,
            verified: this.verified
        };
    }
}

export { PHASE };
