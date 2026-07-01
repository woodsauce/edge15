import type { Countdown } from '@/lib/position/countdown';
import type { Decision, Tone } from '@/lib/types/decision';

export type SignalDirection = 'OVER' | 'UNDER' | 'NONE';
export type SignalStatus = 'NO PLAN' | 'BUILDING' | 'WATCH' | 'LEAN' | 'READY' | 'ENTER' | 'HOLD SIGNAL' | 'CAUTION' | 'CANCELLED';
export type CommitmentStatus = 'SCOUTING' | 'COMMITTED' | 'NO TRADE';

export type SignalPlan = {
  contractKey: string;
  direction: SignalDirection;
  status: SignalStatus;
  displayAction: string;
  tone: Tone;
  stability: number;
  confirmations: number;
  oppositePressure: number;
  createdAt: string;
  updatedAt: string;
  highestStatus: SignalStatus;
  planText: string;
  invalidation: string;
  nextStep: string;
  rawAction: Decision['action'];
  rawDirection: Decision['direction'];
  commitmentStatus: CommitmentStatus;
  committedDirection: SignalDirection;
  committedAt: string | null;
  commitmentReason: string;
  committedEntryScore?: number | null;
  committedConfidence?: number | null;
  committedTradeGrade?: string | null;
  committedSettlementRisk?: Decision['settlement']['risk'] | null;
  committedPrice?: number | null;
  committedDistance?: number | null;
};

export type SignalPlanInput = {
  previous: SignalPlan | null;
  decision: Decision;
  countdown: Countdown;
  now: Date;
};
