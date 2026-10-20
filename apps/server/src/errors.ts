export class Conflict extends Error {}
export class NotFound extends Error {}
/** A worker request uses a different wire protocol; the runner must be updated. */
export class UnsupportedProtocol extends Error {}
