/** Numerical policy only. The caller still owns consent, provenance, exact
 * build binding and authority. Counts never establish real people or quality. */
export function assessPlaytestTargets(participants: number, understoodWithin30Seconds: number, ratedAtLeastFour: number) {
  const validTotal = Number.isSafeInteger(participants) && participants >= 0;
  // Integer tenths avoid rounding a whole-person target down at large counts.
  // Each intermediate/result stays an exact integer within the safe total.
  const required = (tenths: number) => validTotal
    ? Math.floor(participants / 10) * tenths + Math.ceil((participants % 10) * tenths / 10)
    : 0;
  const requiredComprehension = required(8), requiredRatings = required(7);
  const validCounts = validTotal && [understoodWithin30Seconds, ratedAtLeastFour]
    .every(count => Number.isSafeInteger(count) && count >= 0 && count <= participants);
  return {
    minimumParticipants: 10 as const,
    requiredComprehension,
    requiredRatings,
    numericalTargetsMet: validCounts && participants >= 10 &&
      understoodWithin30Seconds >= requiredComprehension && ratedAtLeastFour >= requiredRatings,
  };
}
