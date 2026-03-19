import { bindWindowFunctions } from "../legacy-bridge.js";

export const strategyViewNames = [
  "endS",
  "reaS",
  "delS",
  "delR",
  "delP",
  "togP",
  "togStratApr",
  "doUndo",
  "hCr",
  "hRw",
  "hIv",
  "hPl",
  "hNo",
  "hTk",
  "hEd",
  "hEr",
  "hEp",
  "hEi",
];

const bindings = bindWindowFunctions(strategyViewNames);

export default bindings;
