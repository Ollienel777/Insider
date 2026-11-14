// The owner's named security setups, kept per building in localStorage (Owner
// Mode, SPEC §13, issue 125). They stay in the owner's browser: nothing here sends
// one anywhere. Storage can be blocked or full, so every read and write may
// quietly fail, as with the run log (run-log-store.ts): even reaching
// `localStorage` throws when site data is blocked, so it is reached inside the
// `try`. Writes say whether they landed, so the editor can show the error state.
import { z } from "zod";
import { OwnerSetup } from "@/domain/owner-setup";

export const ownerSetupsKey = (buildingId: string) => `heist:owner-setups:${buildingId}`;

/** The browser's storage, read inside the caller's `try`: the getter itself throws when site data is blocked. */
const browserStorage = (): Storage | undefined => globalThis.localStorage;

/** The stored list: each entry is checked on its own, so one bad setup does not lose the rest. */
const Stored = z.array(z.unknown());

function read(buildingId: string, storage: Pick<Storage, "getItem"> | undefined): OwnerSetup[] {
  const raw = storage?.getItem(ownerSetupsKey(buildingId));
  if (!raw) return [];
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    // A damaged entry reads as none, and the next save writes over it.
    return [];
  }
  const list = Stored.safeParse(json);
  if (!list.success) return [];
  return list.data.flatMap((entry) => {
    const setup = OwnerSetup.safeParse(entry);
    return setup.success && setup.data.buildingId === buildingId ? [setup.data] : [];
  });
}

/** The setups saved for `buildingId`, in the order saved; empty when there are none, they no longer parse, or storage is blocked. */
export function loadOwnerSetups(buildingId: string, storage?: Pick<Storage, "getItem">): OwnerSetup[] {
  try {
    return read(buildingId, storage ?? browserStorage());
  } catch {
    return [];
  }
}

/** Saves `setup` under its building, replacing a saved setup of the same name. False when storage refused it. */
export function saveOwnerSetup(setup: OwnerSetup, storage?: Pick<Storage, "getItem" | "setItem">): boolean {
  try {
    const store = storage ?? browserStorage();
    if (!store) return false;
    const kept = read(setup.buildingId, store).filter((s) => s.name !== setup.name);
    const saved = OwnerSetup.parse(setup);
    store.setItem(ownerSetupsKey(setup.buildingId), JSON.stringify([...kept, saved]));
    return true;
  } catch {
    return false;
  }
}

/** Forgets the setup `name` saved for `buildingId`. False when storage refused it. */
export function deleteOwnerSetup(buildingId: string, name: string, storage?: Pick<Storage, "getItem" | "setItem">): boolean {
  try {
    const store = storage ?? browserStorage();
    if (!store) return false;
    const kept = read(buildingId, store).filter((s) => s.name !== name);
    store.setItem(ownerSetupsKey(buildingId), JSON.stringify(kept));
    return true;
  } catch {
    return false;
  }
}
