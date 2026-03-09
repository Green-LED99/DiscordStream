export enum VoiceOpcode {
  Identify = 0,
  SelectProtocol = 1,
  Ready = 2,
  Heartbeat = 3,
  SelectProtocolAck = 4,
  Speaking = 5,
  HeartbeatAck = 6,
  Resume = 7,
  Hello = 8,
  Resumed = 9,
  ClientsConnect = 11,
  Video = 12,
  ClientDisconnect = 13,
  DavePrepareTransition = 21,
  DaveExecuteTransition = 22,
  DaveTransitionReady = 23,
  DavePrepareEpoch = 24,
  MlsInvalidCommitWelcome = 31,
}

export enum VoiceBinaryOpcode {
  MlsExternalSender = 25,
  MlsKeyPackage = 26,
  MlsProposals = 27,
  MlsCommitWelcome = 28,
  MlsAnnounceCommitTransition = 29,
  MlsWelcome = 30,
}
