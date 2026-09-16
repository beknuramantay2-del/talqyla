export const COUNTERARGUMENTATION_CRITERIA = [
  ['understanding', 'Did the student show they understood the opponent argument?'],
  ['directResponse', 'Did the student answer that argument directly?'],
  ['explanation', 'Did the student explain why the opponent argument is weak, incomplete, or wrong?'],
  ['ownReasoning', 'Did the student give their own reason?'],
  ['connectionToPosition', 'Did the student connect the answer to their own position?'],
];

export function emptyCriterion(reason = 'No evidence in the student response supports this criterion.') {
  return { score: 0, quote: null, reason };
}
