import { bindWindowFunctions } from "../legacy-bridge.js";

export const loopingViewNames = [
  "loopPayloadFromForm",
  "loopTokenPrice",
  "calculateLoopingTotals",
  "loopSupplyValue",
  "loopBorrowValue",
  "loopBorrowTokenAmount",
  "loopLeverage",
  "loopNetApr",
  "calcLoopData",
  "hLoopCr",
  "openLoopDetail",
  "openLoopEdit",
  "hLoopUpd",
  "closeLoop",
  "updateLoopName",
  "renderLoopModal",
];

const bindings = bindWindowFunctions(loopingViewNames);

export default bindings;
