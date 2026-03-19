import { bindWindowFunctions } from "./legacy-bridge.js";

export const renderNames = [
  "render",
  "renderHeader",
  "renderView",
  "renderModals",
  "renderViewOnly",
  "renderModalOnly",
  "renderPegSummary",
  "updateLoopPegPreview",
  "renderLoopModal",
  "renderAdminChart",
  "renderMsgBadges",
  "renderMessagesView",
  "updateLoopRateLabels",
  "R",
  "cardH",
  "pgNav",
];

const bindings = bindWindowFunctions(renderNames);

export const render = bindings.render;
export const renderHeader = bindings.renderHeader;
export const renderView = bindings.renderView;
export const renderModals = bindings.renderModals;
export const renderViewOnly = bindings.renderViewOnly;
export const renderModalOnly = bindings.renderModalOnly;
export const renderPegSummary = bindings.renderPegSummary;
export const updateLoopPegPreview = bindings.updateLoopPegPreview;
export const renderLoopModal = bindings.renderLoopModal;
export const renderAdminChart = bindings.renderAdminChart;
export const renderMsgBadges = bindings.renderMsgBadges;
export const renderMessagesView = bindings.renderMessagesView;
export const updateLoopRateLabels = bindings.updateLoopRateLabels;
export const R = bindings.R;
export const cardH = bindings.cardH;
export const pgNav = bindings.pgNav;

export default {
  ...bindings,
  render,
  renderHeader,
  renderView,
  renderModals,
  renderViewOnly,
  renderModalOnly,
};
