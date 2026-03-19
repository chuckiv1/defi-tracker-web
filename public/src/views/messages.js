import { bindWindowFunctions } from "../legacy-bridge.js";

export const messageViewNames = [
  "loadMessageSummary",
  "msgTs",
  "msgFmt",
  "msgIso",
  "msgCatCls",
  "msgCatLbl",
  "msgPriLbl",
  "msgThreads",
  "msgFilteredThreads",
  "msgSelectedThread",
  "msgAdminSelected",
  "msgResetCompose",
  "msgComposeAll",
  "msgComposeUser",
  "msgLoadDraft",
  "msgPreview",
  "msgPayload",
  "msgSave",
  "msgDelete",
  "msgOpenThread",
  "msgMarkAllRead",
  "msgReplyOpen",
  "hMsgReply",
  "msgSelectAdmin",
  "loadMessageRecipients",
  "loadMessages",
  "openMessages",
  "renderMsgBadges",
  "renderMessagesView",
];

const bindings = bindWindowFunctions(messageViewNames);

export default bindings;
