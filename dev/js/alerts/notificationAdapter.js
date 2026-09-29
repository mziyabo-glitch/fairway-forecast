/**
 * Notification delivery stays disabled.
 * In-app alerts are rendered by the /dev views; this adapter never pushes.
 */

export function createNotificationAdapter({ mode = "in_app_only" } = {}) {
  return {
    mode: "in_app_only",
    requestedMode: mode,
    deliveryEnabled: false,
    deliver() {
      return {
        delivered: false,
        channel: "in_app",
        reason: "delivery_disabled",
      };
    },
  };
}
