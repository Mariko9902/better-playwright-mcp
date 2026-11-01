import debug from 'debug';

const errorsDebug = debug('pw:bp:errors');

export function logUnhandledError(error: unknown) {
  errorsDebug(error);
}

export const testDebug = debug('pw:bp:test');
