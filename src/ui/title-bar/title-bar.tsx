import React from 'react';
import { applicationName } from 'csdm/common/application-name';
import { MenuButton } from './menu-button';
import { WindowControls } from './window-controls/window-controls';
import { UpdateAvailableButton } from './update-available-button';
import { LighterMark } from './lighter-mark';

export function TitleBar() {
  const onDoubleClick = async () => {
    if (!window.csdm.isMac) {
      return;
    }

    const isWindowMaximized = await window.csdm.isWindowMaximized();
    if (isWindowMaximized) {
      window.csdm.unMaximizeWindow();
    } else {
      window.csdm.maximizeWindow();
    }
  };

  return (
    <div
      onDoubleClick={onDoubleClick}
      className="relative z-10 flex h-(--title-bar-height) shrink-0 items-center overflow-hidden border-b border-gray-300 bg-gray-75 text-gray-900 drag"
    >
      {!window.csdm.isMac && <MenuButton />}
      <div className={`flex min-w-0 items-center gap-8 ${window.csdm.isMac ? 'pl-64' : ''}`}>
        <LighterMark />
        <p className="text-caption font-semibold tracking-wide uppercase">{applicationName}</p>
        <p className="text-caption text-gray-600">{APP_VERSION}</p>
      </div>
      <div className="ml-auto flex items-center px-16">
        <UpdateAvailableButton />
      </div>
      {!window.csdm.isMac && <WindowControls />}
    </div>
  );
}
