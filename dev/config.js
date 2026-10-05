// dev/config.js — Rebuild staging configuration

window.APP_CONFIG = {
  WORKER_BASE_URL: "https://fairway-forecast-api.mziyabo.workers.dev",
  // Fill after deploying workers/owner-auth.js and creating a Google web client.
  OWNER_AUTH_BASE_URL: "",
  GOOGLE_CLIENT_ID: "",
  USE_LOCAL_DATASETS: true,
  FEATURE_STATIC_DATASETS: true,
  DATASET_BASE_PATH: "/data/courses",
  DEFAULT_UNITS: "metric",
  DEFAULT_COUNTRY: "gb",
  IS_REBUILD: true,
};
