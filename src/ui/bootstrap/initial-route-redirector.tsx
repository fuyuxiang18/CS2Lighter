import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useUiSettings } from '../settings/ui/use-ui-settings';
import { useArgument } from './use-argument';
import { ArgumentName } from 'csdm/common/argument/argument-name';
import { RoutePath } from '../routes-paths';
import { StartPath } from 'csdm/common/argument/start-path';
import { Page } from 'csdm/node/settings/page';
import { useSettingsOverlay } from '../settings/use-settings-overlay';

export function InitialRouteRedirector() {
  const { initialPage: defaultPage } = useUiSettings();
  const { openSettings } = useSettingsOverlay();
  const startPathArgument = useArgument(ArgumentName.StartPath);
  const navigate = useNavigate();
  const hasRedirected = useRef(false);

  useEffect(() => {
    if (hasRedirected.current) {
      return;
    }

    if (startPathArgument === StartPath.Settings) {
      openSettings();
    }

    let to: string = RoutePath.Habits;
    if (startPathArgument && startPathArgument !== StartPath.Settings) {
      switch (startPathArgument) {
        case StartPath.Bans:
          to = RoutePath.Ban;
          break;
        case StartPath.Demos:
          to = RoutePath.Demos;
          break;
        case StartPath.Downloads:
          to = RoutePath.Habits;
          break;
        case StartPath.Matches:
          to = RoutePath.Matches;
          break;
        case StartPath.Players:
          to = RoutePath.Players;
          break;
        case StartPath.Search:
          to = RoutePath.Search;
          break;
        case StartPath.Teams:
          to = RoutePath.Teams;
          break;
      }
    } else {
      switch (defaultPage) {
        case Page.Habits:
          to = RoutePath.Habits;
          break;
        case Page.Learning:
          to = RoutePath.Learning;
          break;
        case Page.Matches:
          to = RoutePath.Matches;
          break;
        case Page.Demos:
          to = RoutePath.Demos;
          break;
        case Page.Download:
          to = RoutePath.Habits;
          break;
        case Page.Players:
          to = RoutePath.Players;
          break;
        case Page.Teams:
          to = RoutePath.Teams;
          break;
      }
    }

    void (async () => {
      await navigate(to, { replace: true });
      hasRedirected.current = true;
    })();
  }, [defaultPage, navigate, openSettings, startPathArgument]);

  return null;
}
