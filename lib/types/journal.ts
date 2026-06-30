import type { TradeSide } from '@/lib/types/position';
import type { RecommendationAction } from '@/lib/types/decision';

export type TradeOutcome = 'WON' | 'LOST' | 'SKIPPED' | 'BAD_SIGNAL' | 'GOOD_SIGNAL_BAD_ENTRY';

export type TradeReviewReason =
  | 'late_reversal'
  | 'wrong_side_reference'
  | 'entered_too_late'
  | 'signal_flipped'
  | 'too_close_to_reference'
  | 'momentum_failed'
  | 'manual_note';

export type TradeJournalEntry = {
  id: string;
  createdAt: string;
  updatedAt: string;
  side: TradeSide;
  actionAtEntry: RecommendationAction;
  entryWindow: string;
  entryPrice: number | null;
  entryStrike: number | null;
  entryDistance: number | null;
  entryScore: number;
  opportunity: number;
  tradeGrade: string;
  confidence: number;
  stability: number;
  modelTrust: number;
  settlementRisk: string;
  source: string;
  outcome: TradeOutcome | null;
  reviewReason: TradeReviewReason | null;
  note: string;
};

export type JournalSummary = {
  totalReviewed: number;
  wins: number;
  losses: number;
  skipped: number;
  badSignals: number;
  goodSignalBadEntry: number;
  winRate: number | null;
};
