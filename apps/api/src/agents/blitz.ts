import { z } from 'zod';
import { env, type SkillKey } from '@talqyla/config';
import type { AiProvider } from './provider.js';
import { safeJsonParse } from './json.js';

export const BlitzResponseSchema = z.object({ verdict:z.string().min(1).max(400), score:z.number().min(0).max(10), betterVersion:z.string().max(400).default('') });
export interface BlitzOutput { verdict:string; score:number; betterVersion:string; tokensIn:number; tokensOut:number; costUsd:number; model:string; parsed:boolean }
export const BLITZ_PROMPTS: Record<SkillKey,string[]> = {
  STRUCTURE:['За 30 секунд скажи один аргумент строго по схеме: заявка, причина, следствие.','Сжми свою позицию до трёх предложений без потери смысла.'],
  CASE_ANALYSIS:['Назови трёх стейкхолдеров темы и то, что каждый теряет.','Сформулируй главный clash этой темы одним предложением.'],
  REFUTATION:['Опровергни это за 30 секунд, начав со слов «это не работает, потому что…».','Назови самое слабое звено в этом аргументе и ударь только по нему.'],
  QUICK_THINKING:['Ответь на этот POI за 15 секунд, без вводных слов.','Взвесь два импакта и сразу скажи, какой важнее и почему.'],
  CONTENT:['Добавь к своему утверждению один конкретный пример и один механизм.','Объясни причину, а не повторяй заявку другими словами.'],
};
export function pickBlitzPrompt(skill:SkillKey, seed=Date.now()):string { const options=BLITZ_PROMPTS[skill] || BLITZ_PROMPTS.STRUCTURE; return options[seed % options.length] ?? options[0]!; }
export async function runBlitz(ai:AiProvider,input:{skill:string;prompt:string;answer:string;topicTitle:string}):Promise<BlitzOutput>{
 const result=await ai.llm.complete({model:env.LLM_MODEL_JUDGE,system:'Ты — тренер по дебатам. Ответ строго JSON: {"verdict":"...","score":0,"betterVersion":"..."}',messages:[{role:'user',content:`Тема: ${input.topicTitle}\nЗадание: ${input.prompt}\n<ANSWER>${input.answer}</ANSWER>`}],jsonMode:true,maxTokens:250,temperature:0.2});
 const parsed=BlitzResponseSchema.safeParse(safeJsonParse(result.text));
 return {verdict:parsed.success?parsed.data.verdict:'Не удалось разобрать ответ. Попробуй ещё раз.',score:parsed.success?parsed.data.score:0,betterVersion:parsed.success?parsed.data.betterVersion:'',tokensIn:result.tokensIn,tokensOut:result.tokensOut,costUsd:result.costUsd,model:env.LLM_MODEL_JUDGE,parsed:parsed.success};
}
