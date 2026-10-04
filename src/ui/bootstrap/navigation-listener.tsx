import type { ReactNode } from 'react';
import React, { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useWebSocketClient } from '../hooks/use-web-socket-client';
import { ServerPushMessageName } from 'csdm/server/messages/server-push-message-name';
import { RoutePath } from '../routes-paths';
import { useNavigateToMatch } from 'csdm/ui/hooks/use-navigate-to-match';
import { useNavigateToDemo } from 'csdm/ui/hooks/use-navigate-to-demo';

type Props = {
  children: ReactNode;
};

export function NavigationListener({ children }: Props) {
  const client = useWebSocketClient();
  const navigate = useNavigate();
  const navigateToMatch = useNavigateToMatch();
  const navigateToDemo = useNavigateToDemo();

  useEffect(() => {
    const navigateToBans = async () => {
      await navigate(RoutePath.Ban);
    };

    const unListen = window.csdm.onNavigateToBans(navigateToBans);

    return () => {
      unListen();
    };
  }, [navigate]);

  useEffect(() => {
    client.on(ServerPushMessageName.NavigateToDemo, navigateToDemo);

    return () => {
      client.off(ServerPushMessageName.NavigateToDemo, navigateToDemo);
    };
  }, [client, navigateToDemo]);

  useEffect(() => {
    client.on(ServerPushMessageName.NavigateToMatch, navigateToMatch);

    return () => {
      client.off(ServerPushMessageName.NavigateToMatch, navigateToMatch);
    };
  }, [client, navigateToMatch]);

  return <>{children}</>;
}
