import React, { useEffect } from 'react';
import { Link, Outlet, useParams, useSearchParams } from 'react-router';
import { Trans } from '@lingui/react/macro';
import { useDispatch } from 'csdm/ui/store/use-dispatch';
import { useSelector } from 'csdm/ui/store/use-selector';
import { Status } from 'csdm/common/types/status';
import { Message } from 'csdm/ui/components/message';
import { fetchMatchError, fetchMatchStart, fetchMatchSuccess } from 'csdm/ui/match/match-actions';
import { RendererClientMessageName } from 'csdm/server/messages/renderer-client-message-name';
import { useWebSocketClient } from 'csdm/ui/hooks/use-web-socket-client';
import { ErrorCode } from 'csdm/common/error-code';
import { MatchTabs } from './match-tabs';
import { isErrorCode } from 'csdm/common/is-error-code';
import { useIsDemoAnalysisInProgress } from 'csdm/ui/analyses/use-is-demo-analysis-in-progress';
import { RoutePath } from 'csdm/ui/routes-paths';
import { reviewCardIds } from 'csdm/ui/habits/review-storage';
import { useReviewLabels } from 'csdm/ui/habits/use-review-labels';

export function MatchLoader() {
  const [searchParams] = useSearchParams();
  const reviewId = reviewCardIds.find((id) => id === searchParams.get('review'));
  const reviewLabels = useReviewLabels();
  const client = useWebSocketClient();
  const { checksum } = useParams();
  const { match, status, errorCode } = useSelector((state) => state.match.entity);
  const isCurrentMatch = match?.checksum === checksum;
  const isDemoAnalysisInProgress = useIsDemoAnalysisInProgress();
  const dispatch = useDispatch();

  if (checksum === undefined) {
    throw new Error('Match checksum not provided in URL');
  }

  const isAnalysisInProgress = isDemoAnalysisInProgress(checksum);

  useEffect(() => {
    if (isCurrentMatch || isAnalysisInProgress) {
      return;
    }

    const fetchMatch = async () => {
      dispatch(fetchMatchStart());
      try {
        const match = await client.send({
          name: RendererClientMessageName.FetchMatchByChecksum,
          payload: checksum,
        });

        dispatch(fetchMatchSuccess({ match }));
      } catch (error) {
        dispatch(fetchMatchError({ errorCode: isErrorCode(error) ? error : ErrorCode.UnknownError }));
      }
    };

    void fetchMatch();
  }, [dispatch, client, checksum, isCurrentMatch, isAnalysisInProgress]);

  if (isAnalysisInProgress) {
    return <Message message={<Trans>Analyzing demo…</Trans>} />;
  }

  if (status === Status.Loading) {
    return <Message message={<Trans>Fetching match…</Trans>} />;
  }

  if (status === Status.Error) {
    const message =
      errorCode === ErrorCode.MatchNotFound ? <Trans>Match not found.</Trans> : <Trans>An error occurred.</Trans>;

    return <Message message={message} />;
  }

  return (
    <>
      {reviewId && (
        <div className="flex flex-wrap items-center justify-between gap-12 border-b border-accent-muted bg-accent-soft px-20 py-12">
          <div className="min-w-0">
            <p className="text-body-strong text-gray-900">{reviewLabels.cards[reviewId].title}</p>
            <p className="text-caption text-gray-700">{reviewLabels.cards[reviewId].question}</p>
          </div>
          <Link
            className="shrink-0 rounded-8 bg-accent px-16 py-10 text-body-strong text-on-accent no-underline"
            to={RoutePath.Habits}
          >
            <Trans>Back to review</Trans>
          </Link>
        </div>
      )}
      <MatchTabs />
      <Outlet />
    </>
  );
}
