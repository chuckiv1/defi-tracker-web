import { bindWindowFunctions } from "../legacy-bridge.js";

export const priceServiceNames = [
  "fetchPrices",
  "loopTokenDatalist",
  "loopOracleCfg",
  "loopRateKind",
  "apyToApr",
  "normalizeLoopRateToApr",
  "loopRateLabel",
  "updateLoopRateLabels",
  "loopPegKey",
  "loopPegMarketPrice",
  "shouldFetchLoopPegQuote",
  "requestLoopPegQuote",
  "refreshLoopPegQuotes",
  "loopPegInfo",
  "fmtPeg",
  "renderPegSummary",
  "updateLoopPegPreview",
  "fetchLoopOracleDefaults",
  "frfLiveQuote",
  "frfLiveRemaining",
  "frfLiveButtonLabel",
  "frfScheduleLiveTick",
  "frfEnsureLive",
  "frfFetchLive",
];

const bindings = bindWindowFunctions(priceServiceNames);

export default bindings;
