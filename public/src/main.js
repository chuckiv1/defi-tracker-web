import "./app-core.js";

import api from "./api.js";
import data from "./data.js";
import render from "./render.js";
import router from "./router.js";
import state from "./state.js";
import utils from "./utils.js";
import auth from "./services/auth.js";
import prices from "./services/prices.js";
import adminView from "./views/admin.js";
import frfView from "./views/frf.js";
import loopingView from "./views/looping.js";
import messageView from "./views/messages.js";
import modalView from "./views/modals.js";
import strategyView from "./views/strategies.js";

window.__DV_PHASE1_MODULES__ = {
  state,
  api,
  utils,
  data,
  router,
  render,
  services: {
    auth,
    prices,
  },
  views: {
    strategies: strategyView,
    frf: frfView,
    looping: loopingView,
    messages: messageView,
    admin: adminView,
    modals: modalView,
  },
};
