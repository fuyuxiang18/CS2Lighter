let preparingForUpdate = false;

export function isUpdateMaintenance() {
  return preparingForUpdate;
}

export function enterUpdateMaintenance() {
  preparingForUpdate = true;
}
