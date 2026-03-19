import { bindWindowFunctions } from "../legacy-bridge.js";

export const modalViewNames = [
  "cm",
  "renderLoopModal",
  "msgPreview",
  "msgReplyOpen",
  "frfTokenSuggestBox",
  "frfCloseTokenSuggestions",
  "frfRenderTokenSuggestions",
  "updateLoopPegPreview",
];

const bindings = bindWindowFunctions(modalViewNames);

export default bindings;
