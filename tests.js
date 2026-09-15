import assert from 'node:assert/strict';
const SKILLS=['Argumentation','Counterargumentation','Rebuttal','Structure'];
function nextSkill(scores,target){if(scores[target]<70)return target;return [...SKILLS].sort((a,b)=>scores[a]-scores[b])[0]}
function applyScore(s,skill,judge){const n={...s};n[skill]=Math.min(100,n[skill]+Math.max(1,Math.round((judge-5)/2)+3));return n}
function safeJudgeJson(raw){try{const j=JSON.parse(raw); if(typeof j.skillScore==='number'&&j.opponentAttackStrategy)return j}catch{} return {skillScore:5,detectedStrength:'concise_response',detectedWeakness:'missing_direct_rebuttal',opponentAttackStrategy:'challenge_the_missing_link',confidence:.6}}
assert.equal(applyScore({Argumentation:72,Counterargumentation:61,Rebuttal:68,Structure:77},'Counterargumentation',8).Counterargumentation,66);
assert.equal(nextSkill({Argumentation:80,Counterargumentation:58,Rebuttal:63,Structure:74},'Counterargumentation'),'Counterargumentation');
assert.equal(nextSkill({Argumentation:80,Counterargumentation:82,Rebuttal:61,Structure:74},'Counterargumentation'),'Rebuttal');
assert.ok(safeJudgeJson('bad').opponentAttackStrategy);
console.log('tests passed');
