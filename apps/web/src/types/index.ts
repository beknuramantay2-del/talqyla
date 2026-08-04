// Общие типы web-клиента. Держим ровно то, что реально отдаёт API.
export type Stance = 'PRO' | 'CON';

// Рубрика v2. LOGIC и DELIVERY остались в БД от v1 и могут прийти в истории.
export type SkillKey = 'STRUCTURE' | 'CASE_ANALYSIS' | 'REFUTATION' | 'QUICK_THINKING' | 'CONTENT';
export type AnySkillKey = SkillKey | 'LOGIC' | 'DELIVERY';

export type SessionMode = 'SPEECH' | 'BLITZ' | 'CASE';
export type SessionStatus = 'PREP' | 'SPEAKING' | 'SCORING' | 'COMPLETED' | 'ABORTED';
export type SpeakerRole = 'PM' | 'LO' | 'DPM' | 'DLO' | 'MG' | 'MO' | 'GW' | 'OW';

export const SKILL_LABELS: Record<AnySkillKey, string> = {
  STRUCTURE: 'Структура речи',
  CASE_ANALYSIS: 'Анализ кейса',
  REFUTATION: 'Опровержение',
  QUICK_THINKING: 'Скорость мышления',
  CONTENT: 'Аргументация',
  LOGIC: 'Логика',
  DELIVERY: 'Подача',
};

export const ROLE_LABELS: Record<SpeakerRole, string> = {
  PM: 'Prime Minister',
  LO: 'Leader of Opposition',
  DPM: 'Deputy PM',
  DLO: 'Deputy LO',
  MG: 'Member of Government',
  MO: 'Member of Opposition',
  GW: 'Government Whip',
  OW: 'Opposition Whip',
};

export interface User { id: string; email: string; name: string; role: 'USER' | 'ADMIN' }

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

export interface CaseCard {
  stakeholders: string[];
  clashes: { title: string; gov: string; opp: string }[];
  govLines: string[];
  oppLines: string[];
  traps: string[];
  /** false = карту только что сгенерировали, true = отдана из кеша темы. */
  cached: boolean;
}

export interface SessionScore {
  skill: AnySkillKey;
  score: number;
  comment: string | null;
}

export interface PracticeSession {
  id: string;
  topicId: string;
  topic: Topic;
  mode: SessionMode;
  status: SessionStatus;
  role: SpeakerRole;
  stance: Stance;
  focusSkill: AnySkillKey | null;
  speechText: string | null;
  speechSec: number | null;
  poiText: string | null;
  poiAnswer: string | null;
  totalScore: number | null;
  summaryText: string | null;
  strengths: string[];
  weaknesses: string[];
  drillText: string | null;
  drillSkill: AnySkillKey | null;
  ratingDelta: number;
  createdAt: string;
  completedAt: string | null;
  scores: SessionScore[];
}

/** Ответ судьи на сданную речь. */
export interface Ballot {
  sessionId: string;
  totalScore: number;
  maxScore: number;
  scores: SessionScore[];
  strengths: string[];
  weaknesses: string[];
  drill: { skill: SkillKey; task: string };
  summaryText: string;
  nextFocusSkill: AnySkillKey;
  ratingDelta: number;
}

export interface DashboardStats {
  profile: {
    grade: number;
    experienceLevel: string;
    goal: string | null;
    sessionsPlayed: number;
    ratingPoints: number;
    streakDays: number;
    lastSessionAt: string | null;
  };
  stats: {
    totalSessions: number;
    maxScore: number;
    averageScore: number;
    focusSkill: AnySkillKey | null;
    focusLabel: string | null;
    radarData: { skill: AnySkillKey; label: string; score: number; samples: number }[];
  };
  recentSessions: {
    id: string;
    mode: SessionMode;
    status: SessionStatus;
    stance: Stance;
    role: SpeakerRole;
    topicTitle: string;
    category: string;
    score: number | null;
    drillSkill: AnySkillKey | null;
    createdAt: string;
  }[];
}

export interface LeagueRow {
  rank: number;
  name: string;
  ratingPoints: number;
  sessionsPlayed: number;
  isMe: boolean;
}
