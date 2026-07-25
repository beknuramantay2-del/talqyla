// Shared types for web and API client
export type Stance = 'PRO' | 'CON';
export type RoundStatus = 'SETUP' | 'ARGUMENT_BUILT' | 'IN_PROGRESS' | 'AWAITING_JUDGE' | 'COMPLETED' | 'ABORTED';
export type SkillKey = 'STRUCTURE' | 'CONTENT' | 'REFUTATION' | 'LOGIC' | 'DELIVERY';
export type TurnRole = 'STUDENT' | 'OPPONENT';
export type TurnKind = 'OPENING' | 'REBUTTAL' | 'QUESTION' | 'RESPONSE' | 'CLOSING';

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'USER' | 'ADMIN';
}

export interface Topic {
  id: string;
  slug: string;
  title: string;
  description: string;
  category: string;
  difficulty: string;
  proHint: string | null;
  conHint: string | null;
}

export interface DebateRound {
  id: string;
  topicId: string;
  topic: Topic;
  stance: Stance;
  status: RoundStatus;
  argument: { claim: string; warrant: string; impact: string } | null;
  exchangesDone: number;
  focusSkill: SkillKey | null;
  costEstimateUsd: number | null;
  startedAt: string;
  completedAt: string | null;
  turns: DebateTurn[];
  skillScores: SkillScore[];
  feedback: RoundFeedback | null;
}

export interface DebateTurn {
  id: string;
  idx: number;
  role: TurnRole;
  kind: TurnKind;
  contentText: string;
  question: string | null;
  audioUrl: string | null;
  citationRefs: string[];
}

export interface SkillScore {
  id: string;
  skill: SkillKey;
  score: number;
  comment: string | null;
}

export interface RoundFeedback {
  id: string;
  totalScore: number;
  strengths: string[];
  weaknesses: string[];
  advice: string[];
  summaryText: string;
}

export interface DashboardStats {
  profile: {
    grade: number;
    experienceLevel: string;
    goal: string | null;
    roundsPlayed: number;
  };
  stats: {
    totalRounds: number;
    averageScore: number;
    focusSkill: SkillKey | null;
    radarData: { skill: SkillKey; score: number }[];
  };
  recentRounds: {
    id: string;
    topicTitle: string;
    category: string;
    stance: Stance;
    status: RoundStatus;
    score: number | null;
    createdAt: string;
  }[];
}
