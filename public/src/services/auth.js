import { bindWindowFunctions } from "../legacy-bridge.js";

export const authServiceNames = [
  "setPid",
  "logout",
  "hLogin",
  "hReg",
  "verifyCooldownText",
  "resendVerifyMail",
  "hNewProf",
  "delProf",
  "hSupport",
];

const bindings = bindWindowFunctions(authServiceNames);

export const setPid = bindings.setPid;
export const logout = bindings.logout;
export const hLogin = bindings.hLogin;
export const hReg = bindings.hReg;
export const verifyCooldownText = bindings.verifyCooldownText;
export const resendVerifyMail = bindings.resendVerifyMail;
export const hNewProf = bindings.hNewProf;
export const delProf = bindings.delProf;
export const hSupport = bindings.hSupport;

export default bindings;
