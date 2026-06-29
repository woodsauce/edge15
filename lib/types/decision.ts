import type { IndicatorSnapshot } from '@/lib/indicators';

export type RecommendationAction = 'ENTER OVER' | 'ENTER UNDER' | 'LEAN OVER' | 'LEAN UNDER' | 'WATCH OVER' | 'WATCH UNDER' | 'WAIT' | 'AVOID';
export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'blue';

export type Decision = {
  action: RecommendationAction;
  tone: Tone;
  direction: 'OVER' | 'UNDER' | 'NONE';
  entryScore: number;
  entryQuality: string;
  opportunity: number;
  opportunityLabel: string;
  tradeGrade: string;
  confidence: number;
  stability: number;
  reason: string;
  whyNot: string[];
  story: string;
  indicators: IndicatorSnapshot;
};
