import React from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import type { DeathAnimationEvidence } from 'csdm/common/types/death-animation';

export function DeathAnimationDetails({ evidence }: { evidence: DeathAnimationEvidence }) {
  const { t } = useLingui();
  const { framesWithRecipe, decodedTopologyFrames, graphResourceCount, boneCount, maskCount } = evidence;
  const labels: Record<string, string> = {
    'animation-recipe-missing': t`This window contains no usable character animation instructions.`,
    'animation-context-missing': t`The animation resource table is missing or does not match this frame.`,
    'animation-context-invalid': t`The animation resource table could not be decoded completely.`,
    'animation-recipe-incomplete': t`Some animation instructions are incomplete.`,
    'animation-topology-unsupported': t`This animation instruction format has not been verified.`,
    'animation-pose-execution-unverified': t`Final character bone poses have not been reconstructed.`,
    'animation-shot-clock-unverified': t`Character poses still need alignment with the shot and target rewind time.`,
    'animation-actor-ambiguous': t`The character entity could not be matched uniquely.`,
  };
  const tasks: Record<string, string> = {
    CNmAimCSTask: t`Aim pose`,
    CNmSnapWeaponTask: t`Weapon alignment`,
  };
  return (
    <details className="rounded-8 border border-gray-300">
      <summary className="cursor-pointer p-12 text-body-strong">
        <Trans>Character animation evidence</Trans>
      </summary>
      <div className="flex flex-col gap-12 border-t border-gray-300 p-12 text-body">
        <p>
          <Trans>
            Animation recorded in {framesWithRecipe} frames · instruction chains decoded in {decodedTopologyFrames}{' '}
            frames
          </Trans>
        </p>
        {decodedTopologyFrames > 0 && (
          <p>
            <Trans>
              Largest resource definitions: {graphResourceCount} animation references · {boneCount} bones · {maskCount}{' '}
              bone masks
            </Trans>
          </p>
        )}
        {evidence.blockingTasks.length > 0 && (
          <p>
            <Trans>Pose tasks awaiting reconstruction:</Trans>{' '}
            {evidence.blockingTasks.map((task) => tasks[task] ?? task).join(' / ')}
          </p>
        )}
        {evidence.reasons.length > 0 && (
          <ul className="list-inside list-disc text-gray-700">
            {evidence.reasons.map((reason) => (
              <li key={reason}>{labels[reason] ?? reason}</li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
