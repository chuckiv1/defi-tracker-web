import { bindWindowFunctions } from "../legacy-bridge.js";

export const adminViewNames = [
  "loadAdmin",
  "adminTgl",
  "adminFeatTgl",
  "adminDel",
  "adminRole",
  "loadFeatures",
  "hSupport",
  "hFeature",
  "hVote",
  "openAdminDetail",
  "renderAdminChart",
];

const bindings = bindWindowFunctions(adminViewNames);

export default bindings;
