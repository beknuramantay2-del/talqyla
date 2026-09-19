export const LLM_PRICING:Record<string,{input:number;output:number}>={'anthropic/claude-haiku-4.5':{input:1e-6,output:5e-6},'anthropic/claude-sonnet-4.5':{input:3e-6,output:15e-6},'google/gemini-2.5-flash-lite':{input:.1e-6,output:.4e-6}};
export const DEFAULT_LLM_MODEL='anthropic/claude-haiku-4.5';
export function llmCostUsd(model:string,tokensIn:number,tokensOut:number):number{const price=LLM_PRICING[model] ?? LLM_PRICING[DEFAULT_LLM_MODEL]!;return tokensIn*price.input+tokensOut*price.output;}
export const STT_PRICE_PER_SECOND:Record<string,number>={'groq:whisper-large-v3-turbo':.04/3600,'groq:whisper-large-v3':.111/3600,'openai:whisper-1':.006/60,'stub:stub':0};
export const TTS_PRICE_PER_CHAR:Record<string,number>={'openai:tts-1':15/1_000_000,'elevenlabs:default':120/1_000_000,'stub:stub':0};
export function sttCostUsd(provider:string,model:string,seconds:number):number{return(STT_PRICE_PER_SECOND[`${provider}:${model}`]??0)*Math.max(0,seconds)}
export function ttsCostUsd(provider:string,model:string,chars:number):number{return(TTS_PRICE_PER_CHAR[`${provider}:${model}`]??0)*Math.max(0,chars)}
export const EST_SESSION_USD=.008;export const EST_ROUND_USD=.02;export function estimateAudioSeconds(bytes:number):number{return Math.ceil(bytes/20000)}
