import type { Decision } from '@/lib/types/decision';
import type { MarketSnapshot } from '@/lib/types/market';
import type { Countdown } from '@/lib/position/countdown';
import type { TradeSide } from '@/lib/types/position';
import type { JournalSummary, TradeJournalEntry, TradeOutcome, TradeReviewReason } from '@/lib/types/journal';

export const TRADE_JOURNAL_STORAGE_KEY = 'edge15.tradeJournal.v1';

export function createJournalEntry(params: {
  side: TradeSide;
  snapshot: MarketSnapshot;
  decision: Decision;
  countdown: Countdown;
  modelTrust: number;
}): TradeJournalEntry {
  const { side, snapshot, decision, countdown, modelTrust } = params;
  const entryDistance = snapshot.btcPrice !== null && snapshot.strike !== null ? snapshot.btcPrice - snapshot.strike : null;
  const now = new Date().toISOString();
  return {
    id: `trade-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: now,
    updatedAt: now,
    side,
    actionAtEntry: decision.action,
    entryWindow: countdown.display,
    entryPrice: snapshot.btcPrice,
    entryStrike: snapshot.strike,
    entryDistance,
    entryScore: decision.entryScore,
    opportunity: decision.opportunity,
    tradeGrade: decision.tradeGrade,
    confidence: decision.confidence,
    stability: decision.stability,
    modelTrust,
    settlementRisk: decision.settlement.risk,
    source: snapshot.source,
    outcome: null,
    reviewReason: null,
    note: '',
  };
}

export function summarizeJournal(entries: TradeJournalEntry[]): JournalSummary {
  const reviewed = entries.filter((entry) => entry.outcome !== null);
  const wins = reviewed.filter((entry) => entry.outcome === 'WON').length;
  const losses = reviewed.filter((entry) => entry.outcome === 'LOST').length;
  const skipped = reviewed.filter((entry) => entry.outcome === 'SKIPPED').length;
  const badSignals = reviewed.filter((entry) => entry.outcome === 'BAD_SIGNAL').length;
  const goodSignalBadEntry = reviewed.filter((entry) => entry.outcome === 'GOOD_SIGNAL_BAD_ENTRY').length;
  const decisive = wins + losses;
  return {
    totalReviewed: reviewed.length,
    wins,
    losses,
    skipped,
    badSignals,
    goodSignalBadEntry,
    winRate: decisive ? Math.round((wins / decisive) * 1000) / 10 : null,
  };
}

export function outcomeLabel(outcome: TradeOutcome | null) {
  if (outcome === 'WON') return 'Won';
  if (outcome === 'LOST') return 'Lost';
  if (outcome === 'SKIPPED') return 'Skipped';
  if (outcome === 'BAD_SIGNAL') return 'Bad signal';
  if (outcome === 'GOOD_SIGNAL_BAD_ENTRY') return 'Good signal / bad entry';
  return 'Needs review';
}

export function reviewReasonLabel(reason: TradeReviewReason | null) {
  if (reason === 'late_reversal') return 'Late reversal';
  if (reason === 'wrong_side_reference') return 'Wrong side of reference';
  if (reason === 'entered_too_late') return 'Entered too late';
  if (reason === 'signal_flipped') return 'Signal flipped';
  if (reason === 'too_close_to_reference') return 'Too close to reference';
  if (reason === 'momentum_failed') return 'Momentum failed';
  if (reason === 'manual_note') return 'Manual note';
  return 'No reason selected';
}
