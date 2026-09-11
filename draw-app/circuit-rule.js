// ═══════════════════════════════════════════════════════════════════════════
// CIRCUIT - правило победителя
// ═══════════════════════════════════════════════════════════════════════════
//
// ЕДИНСТВЕННОЕ место, где живёт правило. Импортируется и закрывающим
// скриптом (circuit-draw.js), и страницей. Две копии однажды разойдутся, и
// тогда анимация покажет одного победителя, а деньги уйдут другому - это
// худшая из возможных поломок здесь, и она молчаливая.
//
// Модуль браузерный и серверный одновременно: findDeadlineBlock из
// chain-tickets.js уже написан под оба окружения.

import { findDeadlineBlock } from './chain-tickets.js';

// Минимум зон для розыгрыша. Меньше - раунд сливается в следующий, победителя
// нет. Значение обязано совпадать с CIRCUIT_MIN_ZONES в воркере.
export const MIN_ZONES = 20;

/**
 * Зона = BigInt("0x" + block_hash) % проданных зон.
 * hashHex - hex в верхнем регистре, как отдаёт findDeadlineBlock.
 */
export function selectZone(hashHex, sold) {
  if (!hashHex || !sold) throw new Error('selectZone: нужны hashHex и sold');
  return Number(BigInt('0x' + hashHex) % BigInt(sold));
}

/** Блок доски, которому принадлежит зона. null, если зона вне проданной части. */
export function ownerOfZone(blocks, zone) {
  return (blocks || []).find((b) => zone >= b.from && zone <= b.to) || null;
}

/**
 * Полный локальный расчёт по состоянию раунда.
 *
 * Возвращает null, когда показывать нечего: раунд ещё открыт, зон не хватило,
 * или дедлайн пока не наступил в цепи. Ошибку бросает только на настоящей
 * поломке - когда зона оказалась вне доски.
 */
export async function circuitLocalResult(round) {
  if (!round || !round.deadline) return null;
  if (round.sold < MIN_ZONES) return null;
  if (Date.now() < round.deadline) return null;

  let block;
  try {
    block = await findDeadlineBlock(round.deadline);
  } catch (e) {
    return null;   // дедлайн ещё впереди цепи или LCD недоступны - не наша беда
  }

  const zone  = selectZone(block.hash, round.sold);
  const owner = ownerOfZone(round.blocks, zone);
  if (!owner) throw new Error('зона ' + zone + ' вне доски при sold ' + round.sold);

  return {
    roundId: round.roundId,
    winnerZone: zone,
    winner: owner.wallet,
    sold: round.sold,
    blocks: round.blocks,
    blockHash: block.hash,
    blockHeight: block.height,
    blockTimeMs: block.timeMs,
    local: true,
  };
}
