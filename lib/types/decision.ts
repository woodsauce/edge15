export type RecommendationAction = 'ENTER OVER' | 'ENTER UNDER' | 'LEAN OVER' | 'LEAN UNDER' | 'WATCH OVER' | 'WATCH UNDER' | 'WAIT' | 'AVOID';
export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'blue';

export type Decision = {
  action: RecommendationAction;
  tone: Tone;
  entryScore: number;
  entryQuality: string;
  opportunity: number;
  opportunityLabel: string;
  reason: string;
  story: string;
};
