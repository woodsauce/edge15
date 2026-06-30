import type { Countdown } from '@/lib/position/countdown';
import type { Decision, Tone } from '@/lib/types/decision';

export type SignalDirection = 'OVER' | 'UNDER' | 'NONE';
export type SignalStatus = 'NO PLAN' | 'BUILDING' | 'WATCH' | 'LEAN' | 'READY' | 'ENTER' | 'HOLD SIGNAL' | 'CAUTION' | 'CANCELLED';

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
};

export type SignalPlanInput = {
  previous: SignalPlan | null;
  decision: Decision;
  countdown: Countdown;
  now: Date;
};
