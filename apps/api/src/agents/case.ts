import { z } from 'zod';
import { env } from '@talqyla/config';
import type { AiProvider } from './provider.js';
import { safeJsonParse } from './json.js';
export const CaseCardSchema=z.object({stakeholders:z.array(z.string()).min(2).max(6),clashes:z.array(z.string()).min(2).max(4),proArguments:z.array(z.string()).min(2).max(5),conArguments:z.array(z.string()).min(2).max(5),traps:z.array(z.string()).min(1).max(4)});
export type CaseCardData=z.infer<typeof CaseCardSchema>;
export interface CaseCardOutput extends CaseCardData{tokensIn:number;tokensOut:number;costUsd:number;model:string;parsed:boolean}
export const CASE_FALLBACK:CaseCardData={stakeholders:['Кого это касается напрямую','Кто платит за решение','Кто его исполняет'],clashes:['В чём стороны реально расходятся','Работает ли предложенный механизм'],proArguments:['Главная выгода предложения','Кто выигрывает больше всех'],conArguments:['Главная издержка предложения','Почему проблема решается иначе'],traps:['Спорить о теме вообще вместо конкретной формулировки']};
export function buildCasePrompt():string{return 'Ты — тренер по дебатам. Собери нейтральную кейс-карту. Ответ строго JSON: {"stakeholders":[],"clashes":[],"proArguments":[],"conArguments":[],"traps":[]}';}
export async function runCaseCard(ai:AiProvider,input:{topicTitle:string;topicDescription:string}):Promise<CaseCardOutput>{const result=await ai.llm.complete({model:env.LLM_MODEL_CASE,system:buildCasePrompt(),messages:[{role:'user',content:`Тема: ${input.topicTitle}\nОписание: ${input.topicDescription}`}],jsonMode:true,maxTokens:900,temperature:0.4});const parsed=CaseCardSchema.safeParse(safeJsonParse(result.text));return {...(parsed.success?parsed.data:CASE_FALLBACK),tokensIn:result.tokensIn,tokensOut:result.tokensOut,costUsd:result.costUsd,model:env.LLM_MODEL_CASE,parsed:parsed.success};}
