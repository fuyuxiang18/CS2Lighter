import React from 'react';
import { applicationName } from 'csdm/common/application-name';
import { MenuButton } from './menu-button';
import { WindowControls } from './window-controls/window-controls';
import { UpdateAvailableButton } from './update-available-button';

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
      className="relative z-10 flex h-(--title-bar-height) items-center overflow-hidden border-b border-b-gray-300 bg-gray-50 text-gray-900 drag"
    >
      {!window.csdm.isMac && <MenuButton />}
      <div className="mx-auto flex items-center gap-x-16">
        <p>{`${applicationName} ${APP_VERSION}`}</p>
        <UpdateAvailableButton />
      </div>
      {!window.csdm.isMac && <WindowControls />}
    </div>
  );
}
