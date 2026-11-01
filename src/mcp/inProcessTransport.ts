export class InProcessTransport {
  private _server: any;
  private _serverTransport: InProcessServerTransport;
  private _connected = false;

  constructor(server: any) {
    this._server = server;
    this._serverTransport = new InProcessServerTransport(this);
  }

  async start() {
    if (this._connected)
      throw new Error('InprocessTransport already started!');
    await this._server.connect(this._serverTransport);
    this._connected = true;
  }

  async send(message: any, _options?: any) {
    if (!this._connected)
      throw new Error('Transport not connected');
    this._serverTransport._receiveFromClient(message);
  }

  async close() {
    if (this._connected) {
      this._connected = false;
      this.onclose?.();
      this._serverTransport.onclose?.();
    }
  }

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: any, extra?: any) => void;
  sessionId?: string;
  setProtocolVersion?: (version: string) => void;

  _receiveFromServer(message: any, extra?: any) {
    this.onmessage?.(message, extra);
  }
}

class InProcessServerTransport {
  private _clientTransport: InProcessTransport;

  constructor(clientTransport: InProcessTransport) {
    this._clientTransport = clientTransport;
  }

  async start() {}

  async send(message: any, _options?: any) {
    this._clientTransport._receiveFromServer(message);
  }

  async close() {
    this.onclose?.();
  }

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: any) => void;
  sessionId?: string;
  setProtocolVersion?: (version: string) => void;

  _receiveFromClient(message: any) {
    this.onmessage?.(message);
  }
}
