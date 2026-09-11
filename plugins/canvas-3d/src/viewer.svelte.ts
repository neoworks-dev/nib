import { MODEL_DEFAULT_ORBIT, type ModelObject, type ModelOrbit } from "./model";

/**
 * What the viewer window is showing. It holds the object rather than its id: the
 * window outlives the board pane, and a model opened from one board must not go
 * blank because another directory's board took the pane.
 */
class ModelViewerState {
  model = $state<ModelObject | null>(null);
  /** Seeded from the card and then owned by the window; the board keeps its own. */
  orbit = $state<ModelOrbit>(MODEL_DEFAULT_ORBIT);

  show(model: ModelObject): void {
    this.model = model;
    this.resetOrbit();
  }

  resetOrbit(): void {
    const model = this.model;
    this.orbit = model
      ? { yaw: model.yaw, pitch: model.pitch, distance: model.distance }
      : MODEL_DEFAULT_ORBIT;
  }

  reset(): void {
    this.model = null;
    this.orbit = MODEL_DEFAULT_ORBIT;
  }
}

export const modelViewerState = new ModelViewerState();
