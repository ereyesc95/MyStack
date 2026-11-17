import type { ModuleWrapped, ModuleWrappedKind } from "./types";

const store = new Map<string, ModuleWrapped>();

function key(module: string, year: number) {
  return `${module.toLowerCase()}:${year}`;
}

export function getCachedModuleWrapped(
  module: ModuleWrappedKind | string,
  year: number
): ModuleWrapped | null {
  return store.get(key(String(module), year)) ?? null;
}

export function setCachedModuleWrapped(
  module: ModuleWrappedKind | string,
  year: number,
  data: ModuleWrapped
): void {
  store.set(key(String(module), year), data);
}

export { wrappedSeasonYear } from "./listeningWrappedCache";
