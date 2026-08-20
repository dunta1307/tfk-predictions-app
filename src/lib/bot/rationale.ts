import type { Prediction } from './model';

/**
 * A one-line reason per pick, built from the model's own numbers. No language
 * model involved — it reads the expected goals and says what it sees, which
 * keeps it honest and means it can never claim to know about an injury.
 */
export function rationale(p: Prediction, isCaptain: boolean): string {
  const diff = p.expectedHome - p.expectedAway;
  const total = p.expectedHome + p.expectedAway;
  const home = p.homeName, away = p.awayName;

  let line: string;
  if (Math.abs(diff) < 0.25) {
    line = total < 2.4
      ? `Nothing between them and not much expected — ${home} and ${away} both look tight.`
      : `Evenly matched, but both leaky. Goals at either end.`;
  } else if (diff > 0.9) {
    line = `${home} comfortably stronger here, and at home.`;
  } else if (diff > 0.25) {
    line = `${home} shade it, though not by much.`;
  } else if (diff < -0.9) {
    line = `${away} are the better side even away from home.`;
  } else {
    line = `${away} edge it despite being on the road.`;
  }

  const xg = `Model: ${p.expectedHome.toFixed(1)} – ${p.expectedAway.toFixed(1)}`;
  const odds = `${Math.round(p.outcomeChance * 100)}% on the outcome`;
  return isCaptain
    ? `${line} ${xg}, ${odds}. Best expected return of the week, so it takes the armband.`
    : `${line} ${xg}, ${odds}.`;
}

export function summary(predictions: Prediction[], captainId: number | null): string {
  const draws = predictions.filter((p) => p.home === p.away).length;
  const homeWins = predictions.filter((p) => p.home > p.away).length;
  const cap = predictions.find((p) => p.fixture_id === captainId);
  const bits = [
    `${homeWins} home ${homeWins === 1 ? 'win' : 'wins'}`,
    `${draws} ${draws === 1 ? 'draw' : 'draws'}`,
    `${predictions.length - homeWins - draws} away`
  ];
  return `${bits.join(', ')}.${cap ? ` Captain: ${cap.homeName} ${cap.home}-${cap.away} ${cap.awayName}.` : ''}`;
}
