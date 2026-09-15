export type Skill='Argumentation'|'Counterargumentation'|'Rebuttal'|'Structure';
export type Speaker='ai'|'user';
export type DebateMessage={speaker:Speaker;text:string;timestamp:string;round:number};
export type JudgeSignal={skillScore:number;detectedStrength:string;detectedWeakness:string;opponentAttackStrategy:string;confidence:number};
export type DebateSession={sessionId:string;userId:string;topic:string;userPosition:string;aiPosition:string;targetSkill:Skill;round:number;maxRounds:number;messages:DebateMessage[];startedAt:string;finishedAt?:string;status:'active'|'finished'|'expired';scores?:Record<Skill,number>;feedback?:any;nextSkill?:Skill;lastJudgeSignal?:JudgeSignal};
