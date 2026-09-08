/**
 * Oracle Draw V2 - TicketModel
 *
 * Колесо строится из ТОГО ЖЕ массива билетов, который использовал
 * lottery-draw.js. Снимок пишется в rounds/<pool>-<date>.json в момент
 * розыгрыша - восстановить его из /round-stats после раунда нельзя,
 * потому что /round-complete уже проставил consumedInRound.
 *
 * Снимок:
 *   { total: 47, tickets: [["terra1abc", 10, 144, "legendary"], ...] }
 * Третий и четвёртый элементы пары необязательны: tokenId и тир нужны
 * колесу для картинки NFT и цвета редкости, механики не касаются.
 * Порядок пар - тот же обход активаций по usedAt, что и в скрипте.
 * Плоский индекс билета = позиция при разворачивании пар слева направо.
 *
 * MAX_SECTORS больше нет. Сектор = кошелёк, площадь пропорциональна числу
 * билетов, то есть площадь = вероятность выигрыша. Один кошелёк с 10
 * билетами занимает ровно столько же, сколько 10 кошельков по одному.
 *
 * Если кошельков всё равно слишком много - самые мелкие сходятся в один
 * групповой сектор, который раскрывается на остановке (expand()).
 */

const TAU = Math.PI * 2;

export default class TicketModel {

    /**
     * @param {{total:number, tickets:Array<[string,number]>}} snapshot
     * @param {{maxSectors?:number, startAngle?:number}} [opts]
     */
    constructor(snapshot, opts = {}) {
        const pairs = normalizePairs(snapshot);

        this.maxSectors = opts.maxSectors ?? 48;
        this.startAngle = opts.startAngle ?? 0;

        this.total = pairs.reduce((s, p) => s + p[1], 0);
        this.pairs = pairs;

        // плоский индекс -> адрес; строится один раз, дальше O(1)
        this.indexToAddress = new Array(this.total);
        let cursor = 0;
        for (const [address, count] of pairs) {
            for (let i = 0; i < count; i++) this.indexToAddress[cursor++] = address;
        }

        this.#buildSectors();
    }

    /* ---------- построение секторов ---------- */

    #buildSectors() {
        // Слияние по кошельку. Порядок - первое появление в снимке,
        // он детерминирован (usedAt), поэтому колесо у всех одинаковое.
        const order = [];
        const byWallet = new Map();

        const RANK = { common: 0, rare: 1, legendary: 2 };
        this.pairs.forEach(([address, count, tokenId, tier]) => {
            if (!byWallet.has(address)) {
                byWallet.set(address, {
                    address, entries: 0, indices: [],
                    // meta.tier - лучший тир кошелька (им красится сектор),
                    // meta.tiers - сколько entries дал каждый тир,
                    // meta.mints - сколько NFT кошелёк сминтил в этом раунде
                    meta: { tiers: { common: 0, rare: 0, legendary: 0 }, mints: 0 }
                });
                order.push(address);
            }
            const w = byWallet.get(address);
            w.entries += count;
            w.meta.mints += 1;
            const tk = String(tier || "common").toLowerCase();
            if (w.meta.tiers[tk] === undefined) w.meta.tiers[tk] = 0;
            w.meta.tiers[tk] += count;
            // показываем лучший тир кошелька и номер того же NFT
            if (tier && (RANK[tier] ?? -1) > (RANK[w.meta.tier] ?? -1)) {
                w.meta.tier = tier;
                w.meta.tokenId = tokenId;
            } else if (w.meta.tokenId == null && tokenId != null) {
                w.meta.tokenId = tokenId;
            }
        });

        // индексы каждого кошелька - для точного угла конкретного билета
        this.indexToAddress.forEach((address, i) => {
            byWallet.get(address).indices.push(i);
        });

        let wallets = order.map(a => byWallet.get(a));

        // Хвост: самые мелкие кошельки в один групповой сектор
        let group = null;
        if (wallets.length > this.maxSectors) {
            const keep = this.maxSectors - 1;
            const ranked = wallets.slice().sort((a, b) => b.entries - a.entries);
            const kept = new Set(ranked.slice(0, keep).map(w => w.address));
            const tail = wallets.filter(w => !kept.has(w.address));

            wallets = wallets.filter(w => kept.has(w.address));
            group = {
                address: null,
                meta: {},
                entries: tail.reduce((s, w) => s + w.entries, 0),
                indices: tail.flatMap(w => w.indices).sort((a, b) => a - b),
                meta: {},
                members: tail
            };
        }

        const list = group ? wallets.concat([group]) : wallets;

        // углы
        this.sectors = [];
        let angle = this.startAngle;
        list.forEach((w, i) => {
            const span = this.total > 0 ? (w.entries / this.total) * TAU : 0;
            const sector = {
                id: i,
                // Порядковый номер кошелька в раунде - по первому появлению
                // в снимке, то есть по usedAt. Одинаков у всех, кто открыл
                // страницу: считается из файла, а не из порядка отрисовки.
                number: i + 1,
                address: w.address,
                entries: w.entries,
                share: this.total > 0 ? w.entries / this.total : 0,
                startAngle: angle,
                endAngle: angle + span,
                span,
                isGroup: !!w.members,
                members: w.members || null,
                meta: w.meta || {},
                indices: w.indices
            };
            this.sectors.push(sector);
            angle += span;
        });

        // индекс -> сектор, тоже заранее
        this.indexToSector = new Array(this.total);
        this.sectors.forEach(s => {
            s.indices.forEach(i => { this.indexToSector[i] = s; });
        });
    }

    /* ---------- запросы ---------- */

    get sectorCount() { return this.sectors.length; }
    get hasGroup() { return this.sectors.some(s => s.isGroup); }

    /** Адрес по плоскому индексу билета. O(1) */
    addressForIndex(index) {
        return this.indexToAddress[index] ?? null;
    }

    /** Сектор по плоскому индексу билета. O(1) */
    sectorForIndex(index) {
        return this.indexToSector[index] ?? null;
    }

    sectorForAddress(address) {
        return this.sectors.find(s => s.address === address) || null;
    }

    /**
     * Точный угол центра конкретного билета внутри сектора его кошелька.
     * Билеты кошелька идут по возрастанию индекса, поэтому позиция
     * воспроизводима.
     */
    angleForIndex(index) {
        const sector = this.sectorForIndex(index);
        if (!sector) return null;
        const rank = sector.indices.indexOf(index);
        if (rank < 0) return sector.startAngle + sector.span / 2;
        const slice = sector.span / sector.entries;
        return sector.startAngle + slice * (rank + 0.5);
    }

    angleForSector(sector) {
        return sector ? sector.startAngle + sector.span / 2 : null;
    }

    /**
     * Предохранитель. Индекс - основа, адрес из winners.json - проверка.
     * Не сошлось - значит снимок не от этого раунда, крутить нельзя.
     */
    verify(index, address) {
        if (index === null || index === undefined) return false;
        if (index < 0 || index >= this.total) return false;
        return this.addressForIndex(index) === address;
    }

    /** Подмодель для раскрытия группового сектора */
    expand(sector) {
        if (!sector || !sector.isGroup) return null;
        return new TicketModel(
            {
                total: sector.entries,
                tickets: sector.members.map(w => [w.address, w.entries, w.meta && w.meta.tokenId, w.meta && w.meta.tier])
            },
            { maxSectors: this.maxSectors, startAngle: sector.startAngle }
        );
    }

    /** Локальный индекс внутри раскрытой группы */
    localIndex(sector, globalIndex) {
        if (!sector) return -1;
        return sector.indices.indexOf(globalIndex);
    }
}

/* ---------- вход ---------- */

function normalizePairs(snapshot) {
    if (!snapshot) return [];

    // [["addr", 10], ...]
    if (Array.isArray(snapshot.tickets) && Array.isArray(snapshot.tickets[0])) {
        return snapshot.tickets
            .map(p => [String(p[0]), Math.max(0, Number(p[1]) || 0), p[2] ?? null, p[3] ?? null])
            .filter(p => p[0] && p[1] > 0);
    }

    // ["addr","addr","addr", ...] - плоский массив, тоже принимаем
    if (Array.isArray(snapshot.tickets) && typeof snapshot.tickets[0] === "string") {
        const out = [];
        for (const address of snapshot.tickets) {
            const last = out[out.length - 1];
            if (last && last[0] === address) last[1]++;
            else out.push([address, 1]);
        }
        return out;
    }

    // [{address, entries}, ...]
    if (Array.isArray(snapshot.tickets)) {
        return snapshot.tickets
            .map(t => [String(t.address ?? t.wallet ?? ""), Number(t.entries ?? t.count ?? 0) || 0])
            .filter(p => p[0] && p[1] > 0);
    }

    return [];
}
