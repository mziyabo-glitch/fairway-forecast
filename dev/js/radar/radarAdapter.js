/** Provider-neutral radar adapter. Live fetch stays off; the mock provider never calls the network. */

export function createMockRadarProvider() {
  return {
    id: "mock",
    label: "Mock radar",
    live: false,
    attribution: "FairwayWeather mock layers. Not a live radar feed. No external radar request is made.",
    getLayers() {
      return {
        live: false,
        fetched: false,
        layers: [
          { id: "precip", name: "Precipitation", status: "placeholder" },
          { id: "wind", name: "Wind", status: "placeholder" },
        ],
      };
    },
  };
}

export function createRadarAdapter(provider = createMockRadarProvider(), { allowLiveFetch = false } = {}) {
  return {
    providerId: provider?.id || "mock",
    liveFetchEnabled: false,
    allowLiveFetch: false,
    requestedLiveFetch: allowLiveFetch === true,
    load() {
      const layers = provider?.getLayers ? provider.getLayers() : { live: false, fetched: false, layers: [] };
      return {
        ...layers,
        live: false,
        fetched: false,
        attribution: provider?.attribution || "",
        providerLabel: provider?.label || "Radar",
      };
    },
  };
}
