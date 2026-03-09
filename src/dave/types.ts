export type DaveKeyRatchet = {
  cipherSuite: number;
  baseSecret: number[];
};

export type DaveCommitResult = {
  failed: boolean;
  ignored: boolean;
  rosterUpdate: Record<string, number[]> | null;
};

export type DaveMediaTypeMap = {
  Audio: number;
  Video: number;
};

export type DaveCodecMap = {
  Unknown: number;
  Opus: number;
  VP8: number;
  VP9: number;
  H264: number;
  H265: number;
  AV1: number;
};

export type DaveSignaturePrivateKey = unknown;

export interface DaveTransientKeys {
  GetTransientPrivateKey(version: number): DaveSignaturePrivateKey | null;
  Clear(): void;
}

export interface DaveSession {
  Init(
    version: number,
    groupId: bigint,
    selfUserId: string,
    transientKey: DaveSignaturePrivateKey | null
  ): void;
  Reset(): void;
  SetProtocolVersion(version: number): void;
  GetProtocolVersion(): number;
  GetLastEpochAuthenticator(): number[];
  SetExternalSender(externalSender: number[]): void;
  ProcessProposals(proposals: number[], recognizedUserIds: string[]): number[] | null;
  ProcessCommit(commit: number[]): DaveCommitResult;
  ProcessWelcome(welcome: number[], recognizedUserIds: string[]): Record<string, number[]> | null;
  GetMarshalledKeyPackage(): number[];
  GetKeyRatchet(userId: string): DaveKeyRatchet | null;
}

export interface DaveEncryptorInstance {
  SetKeyRatchet(keyRatchet: DaveKeyRatchet | null): void;
  SetPassthroughMode(passthroughMode: boolean): void;
  AssignSsrcToCodec(ssrc: number, codec: number): void;
  GetProtocolVersion(): number;
  GetMaxCiphertextByteSize(mediaType: number, plaintextByteSize: number): number;
  Encrypt(
    mediaType: number,
    ssrc: number,
    framePointer: number,
    frameLength: number,
    frameCapacity: number
  ): number;
  SetProtocolVersionChangedCallback(callback: () => void): void;
}

export interface DaveDecryptorInstance {
  TransitionToKeyRatchet(keyRatchet: DaveKeyRatchet | null): void;
  TransitionToPassthroughMode(passthroughMode: boolean): void;
  GetMaxPlaintextByteSize(mediaType: number, ciphertextByteSize: number): number;
  Decrypt(
    mediaType: number,
    framePointer: number,
    frameLength: number,
    frameCapacity: number
  ): number;
}

export interface DaveModule {
  HEAPU8: Uint8Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  MaxSupportedProtocolVersion(): number;
  MediaType: DaveMediaTypeMap;
  Codec: DaveCodecMap;
  TransientKeys: new () => DaveTransientKeys;
  Session: new (
    context: string,
    authSessionId: string,
    callback: (source: string, reason: string) => void
  ) => DaveSession;
  Encryptor: new () => DaveEncryptorInstance;
  Decryptor: new () => DaveDecryptorInstance;
}
