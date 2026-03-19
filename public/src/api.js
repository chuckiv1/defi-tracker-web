import { bindWindowFunctions } from "./legacy-bridge.js";

export const apiNames = [
  "api",
  "F",
  "loadData",
  "loadLoops",
  "loadAdmin",
  "loadFeatures",
  "loadMessages",
  "loadMessageRecipients",
  "loadMessageSummary",
  "fetchLoopOracleDefaults",
  "requestLoopPegQuote",
  "refreshLoopPegQuotes",
  "frfFetchLive",
];

const bindings = bindWindowFunctions(apiNames);

export const api = bindings.api;
export const F = bindings.F;
export const loadData = bindings.loadData;
export const loadLoops = bindings.loadLoops;
export const loadAdmin = bindings.loadAdmin;
export const loadFeatures = bindings.loadFeatures;
export const loadMessages = bindings.loadMessages;
export const loadMessageRecipients = bindings.loadMessageRecipients;
export const loadMessageSummary = bindings.loadMessageSummary;
export const fetchLoopOracleDefaults = bindings.fetchLoopOracleDefaults;
export const requestLoopPegQuote = bindings.requestLoopPegQuote;
export const refreshLoopPegQuotes = bindings.refreshLoopPegQuotes;
export const frfFetchLive = bindings.frfFetchLive;

export default bindings;
