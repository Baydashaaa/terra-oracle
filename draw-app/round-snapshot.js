/**
 * Oracle Draw - снимок билетов раунда (сторона производителя)
 *
 * ES-модуль: package.json репозитория содержит "type": "module".
 * Импорт только через import, экспорт только через export - CommonJS здесь
 * роняет весь розыгрыш на старте (так пропали 2 и 3 августа 2026).
 *
 * Зачем: колесо на сайте должно быть ТЕМ ЖЕ массивом билетов, по которому
 * считался winner_index. Восстановить его после розыгрыша нельзя -
 * /round-complete проставляет consumedInRound, и /round-stats возвращает
 * уже другое. Поэтому массив замораживается в момент розыгрыша.
 *
 * Лежит в КОРНЕ репозитория, рядом с lottery-draw.js - workflow запускает
 * `node lottery-draw.js` из корня, и WINNERS_PATH там тоже path.resolve
 * от cwd.
 *
 * Файл называется по round_id: rounds/daily_2026-08-01.json. Тот же
 * round_id лежит в winners.json, поэтому клиент никогда не промахнётся
 * мимо снимка - в отличие от поля date, которое берётся в момент записи.
 *
 * При skipped-раунде снимок не пишется.
 */

import fs from "fs";
import path from "path";

const OUT_DIR = path.join(process.cwd(), "rounds");

/**
 * Плоский массив адресов → пары [адрес, подряд идущих билетов].
 * Повторное появление кошелька позже по списку даёт ОТДЕЛЬНУЮ пару -
 * так сохраняется исходный порядок usedAt, а значит и индексы.
 */
function packTickets(tickets, meta) {
    // meta - необязательная карта address -> {tokenId, tier}; нужна колесу,
    // чтобы показать картинку NFT и редкость. На индексы не влияет.
    const pairs = [];
    for (const address of tickets) {
        const last = pairs[pairs.length - 1];
        if (last && last[0] === address) last[1]++;
        else {
            const m = meta && meta[address];
            pairs.push(m ? [address, 1, m.tokenId ?? null, m.tier ?? null] : [address, 1]);
        }
    }
    return pairs;
}

function writeRoundSnapshot({ roundId, pool, tickets, blockHash, blockHeight, winnerIndex, meta }) {
    if (!roundId) throw new Error('round-snapshot: roundId обязателен');
    if (!Array.isArray(tickets) || tickets.length === 0) return null;

    const packed = packTickets(tickets, meta);
    const wallets = new Set(tickets).size;

    const payload = {
        // Файл публичный, на него ведёт ссылка со страницы Verify & Proof,
        // поэтому инструкция на английском - как и весь сайт.
        _verify: [
            "Frozen entry list for this round, in the exact order lottery-draw.js used it.",
            "1. Expand `tickets`: a pair [addr, n] means n consecutive entries for addr.",
            "2. The expanded length must equal `total` and `entries` in winners.json.",
            "3. `winner_index` is a position in that expanded array.",
            "   Daily: a single number. Weekly: one index per place drawn.",
            "4. tickets[winner_index] must equal the winner recorded in winners.json.",
            "",
            "Replaying the draw:",
            "  daily  -> index = BigInt('0x' + block_hash) % total",
            "  weekly -> seed = block_hash; for each place p (0,1,2):",
            "              seed  = sha256(seed + String(p))          // hex",
            "              index = BigInt('0x' + seed) % total",
            "              while the wallet at tickets[index] already won: index = (index + 1) % total",
            "",
            "The block is not the latest one at run time: it is the first block with a",
            "timestamp at or after the round deadline (20:00 UTC), found by binary search.",
            "That makes the result independent of when the script actually ran.",
            "",
            "Where the entry list itself comes from (daily, ticket_rule chain-v1):",
            "Minting an NFT is entering the draw, so the list follows from the NFT",
            "contract alone - no server is involved and nothing has to be trusted:",
            "  contract: terra1hcsq79vmcqxr97sv720yw6scvyknssx62ufsa4rwlmv02gyft43s46uaqx",
            "  a. take tokens with extension.pool = 'daily' and minted_at < deadline",
            "  b. drop those consumed by an earlier draw - a round with fewer than 5",
            "     entries is skipped and consumes nothing, so its tokens roll over",
            "  c. order by (minted_at, token_id), token_id compared as a string",
            "  d. repeat each token extension.entries times",
            "  e. read the owner at block_height, so transferring an NFT after the",
            "     deadline cannot move the prize",
            "",
            "",
            "Weekly (ticket_rule chain-v1+free) is built from two blocks, in this order:",
            "  1. NFT tickets, exactly by the daily rule above but with pool = 'weekly'.",
            "     Their count is recorded as nft_tickets in winners.json.",
            "  2. Free entries from free-entries.json, wallets in ascending string order,",
            "     each repeated by its `total`. Count recorded as free_tickets.",
            "Block 1 can be rebuilt from the chain and checked against nft_tickets.",
            "Block 2 cannot: free entries are earned by chatting and asking questions,",
            "which happens off-chain. What you can check there is the commit history of",
            "free-entries.json in this repository. We would rather point at that limit",
            "than let it hide inside one undifferentiated list.",
            "",
            "One more weekly caveat: which NFTs are still unplayed is read from the",
            "previous completed weekly entry in winners.json (boundary_ts / deadline),",
            "not derived from the chain. It cannot be derived - a weekly round can go",
            "ahead on free entries alone, or be called off because the pool sat below",
            "its minimum, and neither fact is on-chain. For daily, the same boundary IS",
            "derived from the chain and needs no file at all."
        ],
        round_id: roundId,
        pool,
        total: tickets.length,
        wallets,
        tickets: packed,
        block_hash: blockHash || null,
        block_height: blockHeight ?? null,
        winner_index: winnerIndex ?? null,
        generated_at: new Date().toISOString()
    };

    // самопроверка: не выпускаем снимок, который не сходится сам с собой
    const flat = [];
    for (const [addr, n] of packed) for (let i = 0; i < n; i++) flat.push(addr);
    if (flat.length !== tickets.length) {
        throw new Error(`round-snapshot: упаковка потеряла билеты (${flat.length} vs ${tickets.length})`);
    }
    for (let i = 0; i < flat.length; i++) {
        if (flat[i] !== tickets[i]) {
            throw new Error(`round-snapshot: порядок билетов разъехался на позиции ${i}`);
        }
    }

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const file = path.join(OUT_DIR, `${roundId}.json`);
    fs.writeFileSync(file, JSON.stringify(payload, null, 1));
    console.log(`[snapshot] ${file} - ${tickets.length} билетов, ${wallets} кошельков, ${packed.length} пар`);
    return file;
}

export { writeRoundSnapshot, packTickets };
