import http from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { judgeUserMove } from './judge/index.js';
import { routedChat, configuredProviderNames } from './ai/router.js';
import { transcribeAudio } from './ai/stt.js';

type Language = 'ru' | 'kk';
type Session = { sessionId:string; language:Language; targetSkill:string; topic:string; userPosition:string; aiPosition:string; round:number; maxRounds:number; messages:any[]; judgeResults:any[]; status:string; aiProviders:string[]; feedback?:any; nextSkill?:string };
const sessions = new Map<string, Session>();
const fallbackCases = {
  ru: [
    { topic:'Следует ли школам ограничивать использование ИИ в домашних заданиях?', userPosition:'Школы должны обучать ответственному использованию ИИ, а не полностью запрещать его.', aiPosition:'Школы должны ограничивать ИИ, потому что он мешает самостоятельному обучению.', openingQuestion:'Если ученик может получить готовый ответ от ИИ, как учитель поймёт, что ученик действительно разобрался в теме?' },
    { topic:'Нужно ли ограничивать социальные сети для подростков?', userPosition:'Подросткам нужны обучение и поддержка, а не жёсткий запрет.', aiPosition:'Подросткам нужны ограничения, потому что платформы специально удерживают внимание.', openingQuestion:'Если платформы создаются для удержания внимания, почему одной силы воли подростка должно быть достаточно?' },
  ],
  kk: [
    { topic:'Мектептер үй тапсырмасында жасанды интеллектіні пайдалануды шектеуі керек пе?', userPosition:'Мектептер жасанды интеллектіні толық тыймай, оны жауапкершілікпен қолдануды үйретуі керек.', aiPosition:'Мектептер жасанды интеллектіні шектеуі керек, себебі ол өз бетінше оқуға кедергі келтіреді.', openingQuestion:'Оқушы дайын жауапты жасанды интеллектіден алса, мұғалім оның тақырыпты шынымен түсінгенін қалай біледі?' },
    { topic:'Жасөспірімдерге әлеуметтік желі бойынша шектеу қажет пе?', userPosition:'Жасөспірімдерге қатаң тыйым емес, білім мен қолдау қажет.', aiPosition:'Платформалар назарды ұстап тұру үшін жасалғандықтан, шектеу қажет.', openingQuestion:'Платформалар назарды ұстап тұру үшін жасалса, неге жасөспірімнің ерік-жігері жеткілікті деп ойлауымыз керек?' },
  ],
};
const jsonFrom = (text:string) => { try { return JSON.parse(text.replace(/^```json\s*|```$/g,'').trim()); } catch { return null; } };
const lastAi = (s:Session) => [...s.messages].reverse().find(m=>m.speaker==='ai')?.text||'';
const studentTexts = (s:Session) => s.messages.filter(m=>m.speaker==='user').map(m=>m.text);
const quoteExists = (quote:string|null|undefined,texts:string[]) => Boolean(quote && texts.some(t=>t.includes(quote)));

async function createSession(language:Language, targetSkill:string):Promise<Session>{
  const langName=language==='kk'?'қазақ тілінде':'на русском языке';
  const ai=await routedChat({responseFormat:'json_object',temperature:.5,maxTokens:450,messages:[
    {role:'system',content:`Ты создаёшь учебный кейс для школьных дебатов ${langName}. Не придумывай никаких фактов об ученике. Верни только JSON с полями topic, userPosition, aiPosition, openingQuestion. Тема должна быть понятной школьнику и не требовать специальных знаний.`},
    {role:'user',content:`Создай новый кейс. Тренируемый навык: ${targetSkill}.`},
  ]});
  const parsed=jsonFrom(ai.text); const list=fallbackCases[language]; const fallback=list[Math.floor(Math.random()*list.length)]!;
  const c=parsed&&['topic','userPosition','aiPosition','openingQuestion'].every(k=>typeof parsed[k]==='string'&&parsed[k].trim())?parsed:fallback;
  const s:Session={sessionId:randomUUID(),language,targetSkill,topic:c.topic,userPosition:c.userPosition,aiPosition:c.aiPosition,round:1,maxRounds:4,messages:[{id:randomUUID(),speaker:'ai',text:c.openingQuestion,round:1}],judgeResults:[],status:'active',aiProviders:[ai.provider]};
  sessions.set(s.sessionId,s); return s;
}

async function answerSession(id:string,text:string):Promise<Session>{
  const s=sessions.get(id); if(!s)throw Error('Session not found'); if(s.status!=='active')throw Error('Session finished');
  const clean=String(text||'').trim(); if(!clean)throw Error('Empty response');
  s.messages.push({id:randomUUID(),speaker:'user',text:clean,round:s.round});
  const lang=s.language==='kk'?'қазақ тілінде':'на русском языке';
  const judgeAi=await routedChat({responseFormat:'json_object',temperature:.1,maxTokens:650,messages:[
    {role:'system',content:`Ты строгий судья школьных дебатов. Отвечай ${lang}. Оцени только приведённый ответ ученика. Не придумывай биографию, опыт, намерения или другие факты. Каждая цитата должна быть точной подстрокой ответа ученика. Верни JSON: {"skillScore":0-10,"detectedStrength":{"label":"...","quote":"точная цитата или null","reason":"..."},"detectedWeakness":{"label":"...","quote":"точная цитата или null","reason":"..."},"opponentAttackStrategy":"...","nextOpponentInstruction":"...","confidence":0-1}.`},
    {role:'user',content:`Тема: ${s.topic}\nПозиция ученика: ${s.userPosition}\nВопрос оппонента: ${lastAi(s)}\nОтвет ученика: ${clean}`},
  ]});
  const judged=judgeUserMove({targetSkill:s.targetSkill,round:s.round,topic:s.topic,userPosition:s.userPosition,latestAi:lastAi(s),latestUser:clean,llmJson:judgeAi.text});
  s.judgeResults.push(judged); s.aiProviders.push(judgeAi.provider);
  if(s.round>=s.maxRounds){
    s.status='finished'; const scores=s.judgeResults.map(x=>Number(x.skillScore)||0); const score=Math.round((scores.reduce((a,b)=>a+b,0)/scores.length)*10); const texts=studentTexts(s);
    const strengths=s.judgeResults.filter(x=>quoteExists(x.detectedStrength?.quote,texts)).map(x=>({quote:x.detectedStrength.quote,reason:x.detectedStrength.reason}));
    const weaknesses=s.judgeResults.filter(x=>quoteExists(x.detectedWeakness?.quote,texts)).map(x=>({quote:x.detectedWeakness.quote,reason:x.detectedWeakness.reason}));
    s.feedback={score,targetSkill:s.targetSkill,strengths,weaknesses,rounds:s.round,provider:[...new Set(s.aiProviders)].filter(x=>x!=='mock')}; s.nextSkill=s.targetSkill; return s;
  }
  const opponent=await routedChat({temperature:.55,maxTokens:180,messages:[
    {role:'system',content:`Ты оппонент в учебных дебатах. Ответь ${lang}. Используй только тему, позиции и текущий ответ. Не приписывай ученику ничего, чего нет в тексте. Кратко укажи слабое место и задай один точный вопрос. Без оценок и без выдуманных фактов.`},
    {role:'user',content:`Тема: ${s.topic}\nТвоя позиция: ${s.aiPosition}\nОтвет ученика: ${clean}`},
  ]});
  s.round++; s.aiProviders.push(opponent.provider); s.messages.push({id:randomUUID(),speaker:'ai',text:opponent.text.trim()||judged.nextOpponentInstruction||(s.language==='kk'?'Негізгі қарсылығыма нақты жауап бер.':'Ответь на моё центральное возражение.'),round:s.round}); return s;
}

const token=process.env.TELEGRAM_BOT_TOKEN||'',secret=process.env.TELEGRAM_WEBHOOK_SECRET||'',domain=process.env.RAILWAY_PUBLIC_DOMAIN;const publicUrl=process.env.TELEGRAM_WEBAPP_URL||process.env.PUBLIC_URL||(domain?'https://'+domain:'');const tg=(m:string)=>'https://api.telegram.org/bot'+token+'/'+m;
async function telegram(m:string,p:any){const r=await fetch(tg(m),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(p)});if(!r.ok)throw Error(await r.text())}
async function botUpdate(u:any){const chat=u?.message?.chat?.id;if(!chat)return;await telegram('sendMessage',{chat_id:chat,text:'Откройте Talqyla и выберите язык.\nTalqyla қолданбасын ашып, тілді таңдаңыз.',reply_markup:publicUrl?{inline_keyboard:[[{text:'Открыть / Ашу',web_app:{url:publicUrl}}]]}:undefined})}
function equal(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)}
const mime:any={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};async function staticFile(url:string,res:any){const clean=url.split('?')[0]||'/';const path=clean==='/'?'/index.html':clean;try{const data=await readFile(join(process.cwd(),'miniapp',path.replace(/^\//,'')));res.setHeader('content-type',mime[extname(path)]||'application/octet-stream');res.end(data)}catch{res.statusCode=404;res.end('Not found')}}
export const server=http.createServer((req,res)=>{const chunks:Buffer[]=[];let size=0;req.on('data',c=>{size+=c.length;if(size<=12*1024*1024)chunks.push(Buffer.from(c))});req.on('end',async()=>{try{const raw=Buffer.concat(chunks);res.setHeader('cache-control','no-store');if(req.url==='/health')return res.end(JSON.stringify({ok:true,app:'Talqyla Mini App',providers:configuredProviderNames().map(x=>x.name),stt:Boolean(process.env.GROQ_API_KEY||process.env.DEEPGRAM_API_KEY)}));if(req.url==='/api/providers')return res.end(JSON.stringify({llm:configuredProviderNames(),stt:{groq:Boolean(process.env.GROQ_API_KEY),deepgram:Boolean(process.env.DEEPGRAM_API_KEY)}}));if(req.url==='/api/stt'&&req.method==='POST'){if(size>12*1024*1024)throw Error('Audio too large');const out=await transcribeAudio(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),String(req.headers['content-type']||'audio/webm'));res.setHeader('content-type','application/json');return res.end(JSON.stringify(out))}if(req.url==='/telegram/webhook'&&req.method==='POST'){if(secret&&!equal(String(req.headers['x-telegram-bot-api-secret-token']||''),secret)){res.statusCode=401;return res.end()}await botUpdate(JSON.parse(raw.toString()||'{}'));return res.end(JSON.stringify({ok:true}))}if(req.url==='/api/debate/start'&&req.method==='POST'){const b=JSON.parse(raw.toString()||'{}');const language:Language=b.language==='kk'?'kk':'ru';res.setHeader('content-type','application/json');return res.end(JSON.stringify(await createSession(language,String(b.skill|| (language==='kk'?'Теріске шығару':'Опровержение')))))}if(req.url?.startsWith('/api/debate/')&&req.url.endsWith('/respond')){const id=req.url.split('/')[3]!;const b=JSON.parse(raw.toString()||'{}');res.setHeader('content-type','application/json');return res.end(JSON.stringify(await answerSession(id,b.text)))}return staticFile(req.url||'/',res)}catch(e:any){res.statusCode=400;res.setHeader('content-type','application/json');res.end(JSON.stringify({error:e.message}))}})});
const port=Number(process.env.PORT||8787);server.listen(port,'0.0.0.0',async()=>{console.log('Talqyla Mini App listening on '+port);console.log('LLM providers:',configuredProviderNames());console.log('STT:',{groq:Boolean(process.env.GROQ_API_KEY),deepgram:Boolean(process.env.DEEPGRAM_API_KEY)});if(token&&publicUrl){const p:any={url:publicUrl.replace(/\/$/,'')+'/telegram/webhook',allowed_updates:['message']};if(secret)p.secret_token=secret;try{await telegram('setWebhook',p);console.log('Telegram Mini App webhook configured: '+publicUrl)}catch(e){console.error('Webhook setup failed',e)}}});
