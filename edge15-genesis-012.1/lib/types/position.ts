import type { RecommendationAction, Tone } from '@/lib/types/decision';

export type TradeSide = 'OVER' | 'UNDER';
export type PositionStatus = 'HOLD' | 'CAUTION' | 'DANGER';

export type LockedPosition = {
  side: TradeSide;
  entryTime: string;
  entryWindow: string;
  entryPrice: number | null;
  entryStrike: number | null;
  entryAction: RecommendationAction;
  entryScore: number;
  entryOpportunity: number;
  entryConfidence: number;
  entryStability: number;
  entryGrade: string;
};

export type PositionAssessment = {
  status: PositionStatus;
  tone: Tone;
  riskLabel: string;
  unrealizedDistance: number | null;
  distanceSinceEntry: number | null;
  reasons: string[];
  story: string;
};
