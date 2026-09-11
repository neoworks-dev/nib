import type { SessionView } from "@nib-ui/protocol";
import type { SlotName, SlotRegistration, SlotRegistry } from "@nib-ui/ui-contracts";

interface SlotEntry {
  slot: SlotName;
  registration: SlotRegistration;
}

export class ReactiveSlotRegistry implements SlotRegistry {
  private entriesState = $state<SlotEntry[]>([]);

  register(slot: SlotName, registration: SlotRegistration) {
    const entry = { slot, registration };
    this.entriesState = [...this.entriesState, entry];
    return () => {
      this.entriesState = this.entriesState.filter((candidate) => candidate !== entry);
    };
  }

  entries(slot: SlotName, session: SessionView | null): SlotRegistration[] {
    return this.entriesState
      .filter((entry) => entry.slot === slot)
      .map((entry) => entry.registration)
      .filter((registration) => registration.when?.(session) ?? true)
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0));
  }
}
