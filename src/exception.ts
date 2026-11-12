/** Transport or RPC failure. `code` is the gRPC status (0 when unset). */
export class ConfigurationException extends Error {
  readonly code: number;

  constructor(message: string, code = 0) {
    super(message);
    this.name = 'ConfigurationException';
    this.code = code;
  }
}
