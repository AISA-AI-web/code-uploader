// Site configuration. This is the only file you need to edit after deploying the backend.
export const CONFIG = {
  // Your Google Apps Script web app URL (it ends in /exec). See README → "Connect the backend".
  // Leave it empty to run in demo mode, where activities are saved only in your own browser.
  apiUrl: 'https://script.google.com/macros/s/AKfycbyyw62eElula2Lx6r8LS96zHnzaB0JPBO_NYPy0QWO1yZQmo8Goy7F0ozuHpCCe5dem1Q/exec',

  // Names shown in the header and page titles.
  schoolName: 'AISA',
  appName: 'Activity Hub',

  // Optional: the public address of this site, used when building share links and QR codes
  // (for example 'https://activities.aisa.sch.ae/'). Leave empty to use the current address.
  publicBaseUrl: '',
};
