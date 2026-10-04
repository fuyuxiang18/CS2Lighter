import { useLingui } from '@lingui/react/macro';
import type {
  ReviewCardId,
  ReviewDenominator,
  StyleDimensionId,
  ReviewTrendMetricId,
} from 'csdm/common/types/review-insights';

export function useReviewLabels() {
  const { t } = useLingui();
  const cards: Record<ReviewCardId, { title: string; question: string; action: string; context: string }> = {
    'opening-deaths': {
      title: t`First contact, first death`,
      question: t`Before the first duel, did you have information and a teammate ready to follow?`,
      action: t`Before taking first contact, agree on the timing and who can trade.`,
      context: t`Rounds where you were the first enemy kill of the round. Timing and role matter; taking an opening risk can be correct.`,
    },
    'opening-advantage-lost': {
      title: t`Opening advantage lost`,
      question: t`After your opening kill, did the team regroup or keep taking isolated fights?`,
      action: t`After an opening kill, call the advantage and plan the next move together.`,
      context: t`Rounds lost after your opening kill. This describes the outcome, not who caused the loss.`,
    },
    'untraded-deaths': {
      title: t`Deaths without a trade`,
      question: t`Was a trade realistic from your teammates' positions, or were you intentionally isolated?`,
      action: t`Before committing to a fight, check one teammate can follow the same timing.`,
      context: t`Death rounds without a recorded trade within five seconds. Includes deaths where trading was impossible; review before changing your play.`,
    },
    'team-flashes': {
      title: t`Friendly flash rounds`,
      question: t`Did your teammate know the flash timing and have a way to turn away?`,
      action: t`Call the flash before throwing and confirm teammates are ready.`,
      context: t`Rounds with recorded friendly blindness. A brief blind or an agreed team flash is not automatically a mistake.`,
    },
    'lost-clutches': {
      title: t`Clutches to revisit`,
      question: t`What information, time and utility did you have before choosing the next fight?`,
      action: t`In a clutch, check the clock and last known positions before committing.`,
      context: t`Recorded 1vX attempts that were lost. Opponent count and the starting situation strongly affect the outcome.`,
    },
  };
  const denominators: Record<ReviewDenominator, string> = {
    'opening-duels': t`your opening duels`,
    'opening-kill-rounds': t`your opening-kill rounds`,
    'death-rounds': t`rounds with a death`,
    'flash-rounds': t`flash rounds`,
    'clutch-rounds': t`clutch attempts`,
  };
  const style: Record<StyleDimensionId, { title: string; detail: string }> = {
    'opening-participation': {
      title: t`Taking first contact`,
      detail: t`Opening kills + opening deaths / played rounds. Describes how often you enter the first decisive duel.`,
    },
    'trade-kill-share': {
      title: t`Joining trade kills`,
      detail: t`Trade kills / enemy kills. Describes recorded five-second trades, not your distance from teammates.`,
    },
    'utility-round-share': {
      title: t`Using utility`,
      detail: t`Rounds with a grenade thrown / played rounds. Frequency does not measure grenade quality.`,
    },
    survival: {
      title: t`Staying alive`,
      detail: t`Survived rounds / played rounds. Saving, role and round outcome all affect this proportion.`,
    },
    'clutch-exposure': {
      title: t`Playing the last player`,
      detail: t`Recorded 1vX attempts / played rounds. This is the situation you reach, not a passive-play label.`,
    },
  };
  const trends: Record<ReviewTrendMetricId, string> = {
    adr: t`ADR`,
    'headshot-rate': t`Headshot rate`,
    'opening-participation': t`Opening participation`,
    'opening-conversion': t`Opening conversion`,
    'traded-death-share': t`Traded deaths`,
    'utility-round-share': t`Utility round share`,
    survival: t`Survival rate`,
  };
  return { cards, denominators, style, trends };
}
