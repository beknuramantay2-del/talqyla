export type Skill = 'Argumentation' | 'Counterargumentation' | 'Rebuttal' | 'Structure';
export type Speaker = 'ai' | 'user';
export type DebateStatus = 'active' | 'finished' | 'expired';

export const SKILLS: Skill[] = ['Argumentation', 'Counterargumentation', 'Rebuttal', 'Structure'];

export type DebateMessage = {
  id: string;
  speaker: Speaker;
  text: string;
  timestamp: string;
  round: number;
};

export type JudgeEvidence = {
  label: string;
  quote: string | null;
  reason: string;
};

export type RubricCriterionResult = {
  score: 0 | 1 | 2;
  quote: string | null;
  reason: string;
};

export type CounterargumentationRubric = {
  understanding: RubricCriterionResult;
  directResponse: RubricCriterionResult;
  explanation: RubricCriterionResult;
  ownReasoning: RubricCriterionResult;
  connectionToPosition: RubricCriterionResult;
};

export type MoveJudgeResult = {
  round: number;
  targetSkill: Skill;
  skillScore: number;
  detectedStrength: JudgeEvidence;
  detectedWeakness: JudgeEvidence;
  rubric: CounterargumentationRubric;
  opponentAttackStrategy: string;
  nextOpponentInstruction: string;
  confidence: number;
  source: 'llm' | 'fallback';
};

export type FeedbackCard = {
  title: string;
  quote: string;
  explanation: string;
};

export type FinalJudgeResult = {
  overallBefore: number;
  overallAfter: number;
  delta: number;
  targetSkill: Skill;
  strongest: Skill;
  needsWork: Skill;
  feedbackCards: FeedbackCard[];
  nextSkill: Skill;
  nextTraining: string;
  coachLine: string;
  scores: Record<Skill, number>;
};

export type JudgeSignal = {
  skillScore: number;
  detectedStrength: string;
  detectedWeakness: string;
  opponentAttackStrategy: string;
  confidence: number;
};

export type DebateSession = {
  sessionId: string;
  userId: string;
  topic: string;
  userPosition: string;
  aiPosition: string;
  targetSkill: Skill;
  round: number;
  maxRounds: number;
  messages: DebateMessage[];
  startedAt: string;
  finishedAt?: string;
  status: DebateStatus;
  scores?: Record<Skill, number>;
  feedback?: FinalJudgeResult;
  nextSkill?: Skill;
  lastJudgeSignal?: JudgeSignal;
  judgeResults: MoveJudgeResult[];
};
