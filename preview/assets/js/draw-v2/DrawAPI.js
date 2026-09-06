/**
 * Oracle Draw V2 - DrawAPI
 *
 * Схема winners.json взята из рабочего loadWinners() в app.js:
 *   daily : { date, winner, prize_lunc, entries, block_hash, block_height,
 *             winner_index, tx_winner, skipped }
 *   weekly: { date, winners:[{place, address, amount_lunc, tx}], entries,
 *             block_hash, block_height, tx_treasury, skipped }
 *
 * ВАЖНО: round_id в файле НЕТ - идентификатор раунда собираем как
 * "pool:date". Первая версия этого модуля искала round_id и молча
 * отбросила бы все записи.
 */

import { CONFIG } from "./Config.js";

/** Идентификатор раунда: "daily:2026-07-24" */
function makeKey(raw, pool, index) {
    if (raw.round_id) return String(raw.round_id);
    if (raw.date) return `${pool}:${raw.date}`;
    return `${pool}:#${index}`;
}

/** Момент розыгрыша: дата из файла + 20:00 UTC */
function drawMoment(raw) {
    if (raw.block_time) {
        const t = Date.parse(raw.block_time);
        if (!Number.isNaN(t)) return t;
    }
    if (raw.date) {
        const hh = String(CONFIG.DRAW_HOUR_UTC).padStart(2, "0");
        const t = Date.parse(`${raw.date}T${hh}:00:00Z`);
        if (!Number.isNaN(t)) return t;
    }
    return null;
}

export function normalizeRound(raw, pool, index) {
    if (!raw || typeof raw !== "object") return null;

    const key = makeKey(raw, pool, index);

    // weekly: массив мест
    let winners = [];
    if (Array.isArray(raw.winners) && raw.winners.length) {
        winners = raw.winners.map((w, i) => ({
            place: w.place ?? i + 1,
            address: w.address ?? w.winner ?? null,
            prize: Number(w.amount_lunc ?? w.prize_lunc ?? 0) || 0,
            tx: w.tx ?? null,
            index: Number.isFinite(Number(w.winner_index)) ? Number(w.winner_index) : null
        })).filter(w => w.address);
    } else if (raw.winner) {
        winners = [{
            place: 1,
            address: raw.winner,
            prize: Number(raw.prize_lunc ?? raw.prize ?? 0) || 0,
            tx: raw.tx_winner ?? null,
            index: Number.isFinite(Number(raw.winner_index)) ? Number(raw.winner_index) : null
        }];
    }

    const skipped = raw.skipped === true || winners.length === 0;
    const first = winners[0] || null;

    return {
        key,
        pool,
        date: raw.date ?? null,
        skipped,
        reason: raw.reason ?? null,

        winner: first ? first.address : null,
        winnerIndex: first ? first.index : null,
        prize: first ? first.prize : 0,
        winners,

        entries: Number(raw.entries ?? 0) || 0,
        participants: Number(raw.participants ?? 0) || 0,

        blockHash: raw.block_hash ?? null,
        blockHeight: raw.block_height ?? null,
        randomness: raw.randomness ?? null,
        txTreasury: raw.tx_treasury ?? null,

        drawnAt: drawMoment(raw),
        raw
    };
}

export default class DrawAPI {

    constructor(url = CONFIG.WINNERS_JSON) {
        this.url = url;
        this.lastText = null;
        this.lastPayload = null;
    }

    /**
     * @returns {Promise<object|null>} null = файл не изменился с прошлого раза
     */
    async load({ force = false } = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), CONFIG.FETCH_TIMEOUT);

        let text;
        try {
            const res = await fetch(`${this.url}?t=${Date.now()}`, {
                cache: "no-store",
                signal: controller.signal
            });
            if (!res.ok) throw new Error(`winners.json HTTP ${res.status}`);
            text = await res.text();
        } catch (err) {
            if (err.name === "AbortError") throw new Error("winners.json timeout");
            throw err;
        } finally {
            clearTimeout(timer);
        }

        if (!force && text === this.lastText) return null;

        let json;
        try {
            json = JSON.parse(text);
        } catch {
            throw new Error("winners.json: невалидный JSON");
        }

        this.lastText = text;
        this.lastPayload = {
            daily: this.#list(json[CONFIG.DAILY], CONFIG.DAILY),
            weekly: this.#list(json[CONFIG.WEEKLY], CONFIG.WEEKLY),
            meta: json._meta ?? null,
            fetchedAt: Date.now()
        };
        return this.lastPayload;
    }

    /**
     * Снимок билетов раунда. Возвращает null, если файла нет -
     * у старых раундов его не будет, это не ошибка.
     */
    async loadSnapshot(roundKey) {
        if (!roundKey) return null;
        const cacheKey = roundKey;
        this._snapshots ||= new Map();
        if (this._snapshots.has(cacheKey)) return this._snapshots.get(cacheKey);

        const url = CONFIG.ROUND_SNAPSHOT.replace("{round}", encodeURIComponent(roundKey));
        try {
            const res = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
            if (!res.ok) { this._snapshots.set(cacheKey, null); return null; }
            const json = await res.json();
            this._snapshots.set(cacheKey, json);
            return json;
        } catch {
            this._snapshots.set(cacheKey, null);
            return null;
        }
    }

    #list(arr, pool) {
        if (!Array.isArray(arr)) return [];
        return arr.map((item, i) => normalizeRound(item, pool, i)).filter(Boolean);
    }

    /**
     * Самый свежий раунд. Сортируем по drawnAt - порядок в файле
     * гарантировать нельзя, а даты сравнимы всегда.
     */
    static pickLatest(list) {
        if (!Array.isArray(list) || list.length === 0) return null;
        return list.reduce((best, cur) => {
            if (!best) return cur;
            return (cur.drawnAt ?? 0) > (best.drawnAt ?? 0) ? cur : best;
        }, null);
    }
}
