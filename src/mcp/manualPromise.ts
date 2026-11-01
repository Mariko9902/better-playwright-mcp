export class ManualPromise<T = any> extends Promise<T> {
  private _resolve!: (value: T | PromiseLike<T>) => void;
  private _reject!: (reason?: any) => void;
  private _isDone: boolean;

  constructor() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: any) => void;
    super((f, r) => {
      resolve = f;
      reject = r;
    });
    this._isDone = false;
    this._resolve = resolve;
    this._reject = reject;
  }

  isDone() {
    return this._isDone;
  }

  resolve(value: T) {
    this._isDone = true;
    this._resolve(value);
  }

  reject(error: any) {
    this._isDone = true;
    this._reject(error);
  }

  static get [Symbol.species]() {
    return Promise;
  }

  get [Symbol.toStringTag]() {
    return 'ManualPromise';
  }
}

export class LongStandingScope {
  private _terminateError?: Error;
  private _closeError?: Error;
  private _terminatePromises = new Map<ManualPromise<any>, string[]>();
  private _isClosed = false;

  reject(error: Error) {
    this._isClosed = true;
    this._terminateError = error;
    for (const p of this._terminatePromises.keys())
      p.resolve(error);
  }

  close(error: Error) {
    this._isClosed = true;
    this._closeError = error;
    for (const [p, frames] of this._terminatePromises)
      p.resolve(cloneError(error, frames));
  }

  isClosed() {
    return this._isClosed;
  }

  static async raceMultiple(scopes: LongStandingScope[], promise: Promise<any>) {
    return Promise.race(scopes.map(s => s.race(promise)));
  }

  async race(promise: Promise<any> | Promise<any>[]) {
    return this._race(Array.isArray(promise) ? promise : [promise], false);
  }

  async safeRace(promise: Promise<any>, defaultValue: any) {
    return this._race([promise], true, defaultValue);
  }

  private async _race(promises: Promise<any>[], safe: boolean, defaultValue?: any) {
    const terminatePromise = new ManualPromise<any>();
    const frames = captureRawStack();
    if (this._terminateError)
      terminatePromise.resolve(this._terminateError);
    if (this._closeError)
      terminatePromise.resolve(cloneError(this._closeError, frames));
    this._terminatePromises.set(terminatePromise, frames);
    try {
      return await Promise.race([
        terminatePromise.then(e => safe ? defaultValue : Promise.reject(e)),
        ...promises,
      ]);
    } finally {
      this._terminatePromises.delete(terminatePromise);
    }
  }
}

function cloneError(error: Error, frames: string[]) {
  const clone = new Error();
  clone.name = error.name;
  clone.message = error.message;
  clone.stack = [error.name + ':' + error.message, ...frames].join('\n');
  return clone;
}

function captureRawStack() {
  const stackTraceLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = 50;
  const error = new Error();
  const stack = error.stack || '';
  Error.stackTraceLimit = stackTraceLimit;
  return stack.split('\n');
}
