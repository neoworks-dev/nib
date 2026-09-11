import type { Disposer } from "@nib-ui/kernel";
import type { Project, Session } from "./schema";

/** One row of the project list, without loading the whole document. */
export interface ProjectSummary {
  cwd: string;
  rev: number;
  sessions: Pick<Session, "id" | "goal" | "sessionId" | "reviewedAt">[];
}

/**
 * The authored document, one per working directory. Sessions and assets are
 * placed here; everything a harness reports stays in the event log and is joined
 * against `Session.sessionId` on read.
 */
export interface ProjectStore {
  list(): Promise<ProjectSummary[]>;
  /** A missing project reads as an empty one at `rev` 0, not as an error. */
  load(cwd: string): Promise<Project>;
  /** Rejects unless `rev` is exactly the stored revision plus one. */
  save(project: Project): Promise<Project>;
  /** Writes from every window on the same directory, newest `rev` first. */
  subscribe(cwd: string, fromRev: number, onProject: (project: Project) => void): Disposer;
}
