import { executeStudy } from "./research2027.js";
self.onmessage = ({ data }) => {
  try {
    const result = executeStudy(data.id, data.config);
    self.postMessage({ ok: true, result });
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
