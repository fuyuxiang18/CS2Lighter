import React, { useEffect } from 'react';
import { LeftBar } from 'csdm/ui/left-bar/left-bar';
import { AppWrapper } from './app-wrapper';
import { AppContent } from './app-content';
import { NavigationListener } from './navigation-listener';
import { ContextMenuProvider } from '../components/context-menu/context-menu-provider';
import { useArgumentsContext } from './use-arguments-context';
import { Outlet } from 'react-router';
import { ImportProgressGate } from 'csdm/ui/imports/import-progress-gate';

export function App() {
  const { clearArguments } = useArgumentsContext();

  useEffect(() => {
    // The app has been renderer, we can now clear startup arguments so that they will be ignored when
    // reloading the window.
    clearArguments();
  }, [clearArguments]);

  return (
    <NavigationListener>
      <ContextMenuProvider>
        <AppWrapper>
          <LeftBar />
          <AppContent>
            <ImportProgressGate>
              <Outlet />
            </ImportProgressGate>
          </AppContent>
        </AppWrapper>
      </ContextMenuProvider>
    </NavigationListener>
  );
}
