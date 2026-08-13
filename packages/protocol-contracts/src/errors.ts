export class ProtocolValidationError extends Error {
  readonly path: string | undefined;

  constructor(message: string, path?: string) {
    super(path === undefined ? message : `${path}: ${message}`);
    this.name = 'ProtocolValidationError';
    this.path = path;
  }
}

export class ActivationCodeError extends ProtocolValidationError {
  constructor(message = 'activation code must contain exactly six ASCII digits') {
    super(message, 'activation.code');
    this.name = 'ActivationCodeError';
  }
}

export class FrameCodecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FrameCodecError';
  }
}
