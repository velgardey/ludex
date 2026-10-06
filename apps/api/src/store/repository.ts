export type Stored = {
  id: string;
  scope: string;
  version: number;
  body: unknown;
  etag: string;
};
export type Operation =
  | { kind: "create"; value: Stored }
  | { kind: "replace"; value: Stored; expectedEtag: string }
  | { kind: "delete"; id: string; expectedEtag: string };
export interface Repository {
  read(scope: string, id: string): Promise<Stored | null>;
  list(scope: string, prefix?: string): Promise<Stored[]>;
  transact(
    scope: string,
    operations: Operation[],
  ): Promise<"committed" | "conflict">;
  close?(): void;
}
export const stored = (
  scope: string,
  id: string,
  body: unknown,
  version = 1,
): Stored => ({ scope, id, body, version, etag: "" });
