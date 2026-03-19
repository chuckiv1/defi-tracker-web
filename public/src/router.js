import { bindWindowFunctions } from "./legacy-bridge.js";

export const routerNames = [
  "setPgAct",
  "setPgPast",
  "setPgFrfO",
  "setPgFrfC",
  "setPid",
  "logout",
  "dBack",
  "rBack",
  "openMessages",
  "openLoopDetail",
  "openLoopEdit",
  "openAdminDetail",
  "R",
];

const bindings = bindWindowFunctions(routerNames);

export const setPgAct = bindings.setPgAct;
export const setPgPast = bindings.setPgPast;
export const setPgFrfO = bindings.setPgFrfO;
export const setPgFrfC = bindings.setPgFrfC;
export const setPid = bindings.setPid;
export const logout = bindings.logout;
export const dBack = bindings.dBack;
export const rBack = bindings.rBack;
export const openMessages = bindings.openMessages;
export const openLoopDetail = bindings.openLoopDetail;
export const openLoopEdit = bindings.openLoopEdit;
export const openAdminDetail = bindings.openAdminDetail;
export const R = bindings.R;

export default bindings;
