import { bindWindowFunctions } from "./legacy-bridge.js";

export const utilityNames = [
  "uiKey",
  "saveUi",
  "restoreUi",
  "normUi",
  "cm",
  "tgl",
  "fd",
  "fds",
  "fts",
  "db",
  "calcApr",
  "fn",
  "fpr",
  "es",
  "onlineMeta",
  "onlineBadge",
  "ci",
  "tr",
  "posFloatingPnl",
  "posPnl",
  "tp",
  "tg",
  "bp",
  "wa",
  "hintAttr",
  "msgTs",
  "msgFmt",
  "msgIso",
  "msgCatCls",
  "msgCatLbl",
  "msgPriLbl",
];

const bindings = bindWindowFunctions(utilityNames);

export const uiKey = bindings.uiKey;
export const saveUi = bindings.saveUi;
export const restoreUi = bindings.restoreUi;
export const normUi = bindings.normUi;
export const cm = bindings.cm;
export const tgl = bindings.tgl;
export const fd = bindings.fd;
export const fds = bindings.fds;
export const fts = bindings.fts;
export const db = bindings.db;
export const calcApr = bindings.calcApr;
export const fn = bindings.fn;
export const fpr = bindings.fpr;
export const es = bindings.es;
export const onlineMeta = bindings.onlineMeta;
export const onlineBadge = bindings.onlineBadge;
export const ci = bindings.ci;
export const tr = bindings.tr;
export const posFloatingPnl = bindings.posFloatingPnl;
export const posPnl = bindings.posPnl;
export const tp = bindings.tp;
export const tg = bindings.tg;
export const bp = bindings.bp;
export const wa = bindings.wa;
export const hintAttr = bindings.hintAttr;
export const msgTs = bindings.msgTs;
export const msgFmt = bindings.msgFmt;
export const msgIso = bindings.msgIso;
export const msgCatCls = bindings.msgCatCls;
export const msgCatLbl = bindings.msgCatLbl;
export const msgPriLbl = bindings.msgPriLbl;

export default bindings;
